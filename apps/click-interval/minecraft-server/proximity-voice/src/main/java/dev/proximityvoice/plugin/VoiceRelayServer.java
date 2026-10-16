package dev.proximityvoice.plugin;

import dev.proximityvoice.core.OutboundDatagram;
import dev.proximityvoice.core.Protocol;
import dev.proximityvoice.core.VoiceRelayEngine;

import java.io.Closeable;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.util.Arrays;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

public final class VoiceRelayServer implements Closeable {
    private final VoiceRelayEngine engine;
    private final Consumer<String> errorSink;
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicReference<String> lastError = new AtomicReference<>("");
    private volatile DatagramSocket socket;
    private volatile Thread receiverThread;

    public VoiceRelayServer(VoiceRelayEngine engine, Consumer<String> errorSink) {
        this.engine = Objects.requireNonNull(engine, "engine");
        this.errorSink = Objects.requireNonNull(errorSink, "errorSink");
    }

    public synchronized int start(String bindAddress, int port) throws IOException {
        if (running.get()) return boundPort();
        lastError.set("");
        InetSocketAddress address = bindAddress == null || bindAddress.isBlank()
                ? new InetSocketAddress(port)
                : new InetSocketAddress(InetAddress.getByName(bindAddress), port);
        DatagramSocket opened = new DatagramSocket(null);
        try {
            opened.setReuseAddress(false);
            opened.setReceiveBufferSize(1024 * 1024);
            opened.setSendBufferSize(1024 * 1024);
            opened.bind(address);
        } catch (IOException error) {
            opened.close();
            throw error;
        }
        socket = opened;
        running.set(true);
        receiverThread = new Thread(this::receiveLoop, "ProximityVoice-UDP");
        receiverThread.setDaemon(true);
        receiverThread.start();
        return opened.getLocalPort();
    }

    private void receiveLoop() {
        DatagramSocket activeSocket = socket;
        byte[] buffer = new byte[Protocol.MAX_DATAGRAM_BYTES + 1];
        DatagramPacket inbound = new DatagramPacket(buffer, buffer.length);
        DatagramPacket outboundPacket = new DatagramPacket(new byte[0], 0);
        try {
            while (running.get()) {
                try {
                    inbound.setLength(buffer.length);
                    activeSocket.receive(inbound);
                } catch (SocketException closed) {
                    if (running.get()) failReceiver(closed, activeSocket);
                    break;
                } catch (IOException receiveError) {
                    failReceiver(receiveError, activeSocket);
                    break;
                }
                if (!running.get()) break;
                try {
                    if (inbound.getLength() > Protocol.MAX_DATAGRAM_BYTES) continue;
                    byte[] data = Arrays.copyOfRange(
                            inbound.getData(), inbound.getOffset(), inbound.getOffset() + inbound.getLength());
                    for (OutboundDatagram outbound : engine.handle(data, inbound.getSocketAddress())) {
                        byte[] response = outbound.data();
                        outboundPacket.setData(response, 0, response.length);
                        outboundPacket.setSocketAddress(outbound.destination());
                        activeSocket.send(outboundPacket);
                    }
                } catch (SocketException closed) {
                    if (running.get()) failReceiver(closed, activeSocket);
                    break;
                } catch (IOException error) {
                    reportError(error);
                } catch (RuntimeException error) {
                    reportError(error);
                }
            }
        } catch (Throwable fatal) {
            failReceiver(fatal, activeSocket);
            if (fatal instanceof Error error) throw error;
        } finally {
            if (running.getAndSet(false)) {
                reportError(new IllegalStateException("UDP receiver stopped unexpectedly."));
                if (activeSocket != null && !activeSocket.isClosed()) activeSocket.close();
            }
        }
    }

    private void failReceiver(Throwable error, DatagramSocket activeSocket) {
        if (!running.getAndSet(false)) return;
        try {
            reportError(error);
        } finally {
            if (activeSocket != null && !activeSocket.isClosed()) activeSocket.close();
        }
    }

    private void reportError(Throwable error) {
        String message = String.valueOf(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
        String previous = lastError.getAndSet(message);
        if (!message.equals(previous)) {
            try {
                errorSink.accept(message);
            } catch (RuntimeException ignored) {
                // A status/logging callback must never keep a failed receiver marked alive.
            }
        }
    }

    public boolean running() {
        return running.get();
    }

    public int boundPort() {
        DatagramSocket current = socket;
        return current == null || current.isClosed() ? 0 : current.getLocalPort();
    }

    public String lastError() {
        return lastError.get();
    }

    @Override
    public synchronized void close() {
        running.set(false);
        DatagramSocket current = socket;
        if (current != null) current.close();
        Thread thread = receiverThread;
        receiverThread = null;
        if (thread != null && thread != Thread.currentThread()) {
            try {
                thread.join(2_000L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
        socket = null;
    }
}
