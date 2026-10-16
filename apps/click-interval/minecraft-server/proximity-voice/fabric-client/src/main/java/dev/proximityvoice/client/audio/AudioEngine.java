package dev.proximityvoice.client.audio;

import dev.proximityvoice.client.config.ClientSettings;
import dev.proximityvoice.client.core.FrameJitterBuffer;
import dev.proximityvoice.client.core.SpatialAudio;
import dev.proximityvoice.client.protocol.Protocol;
import io.github.jaredmdobson.concentus.OpusApplication;
import io.github.jaredmdobson.concentus.OpusDecoder;
import io.github.jaredmdobson.concentus.OpusEncoder;
import io.github.jaredmdobson.concentus.OpusException;

import javax.sound.sampled.LineUnavailableException;
import javax.sound.sampled.SourceDataLine;
import javax.sound.sampled.TargetDataLine;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * Live-only audio pipeline. PCM and Opus frames remain in bounded memory buffers and are never written to disk.
 */
public final class AudioEngine implements AutoCloseable {
    public static final int SAMPLE_RATE = 48_000;
    public static final int FRAME_SAMPLES = 960;
    public static final int FRAME_MILLIS = 20;
    private static final int MAX_REMOTE_STREAMS = 16;

    private final ClientSettings settings;
    private final Consumer<byte[]> voiceSender;
    private final BooleanSupplier transmitEnabled;
    private final Function<UUID, SpatialSnapshot> spatialProvider;
    private final ConcurrentHashMap<UUID, RemoteStream> remoteStreams = new ConcurrentHashMap<>();
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicLong runGeneration = new AtomicLong();
    private final AtomicBoolean restartRequested = new AtomicBoolean();
    private final AtomicReference<String> lastError = new AtomicReference<>("");
    private volatile double voiceRadius = 48.0;
    private volatile double inputLevel;
    private Thread captureThread;
    private Thread playbackThread;
    private volatile TargetDataLine inputLine;
    private volatile SourceDataLine outputLine;

    public AudioEngine(ClientSettings settings, Consumer<byte[]> voiceSender,
                       BooleanSupplier transmitEnabled,
                       Function<UUID, SpatialSnapshot> spatialProvider) {
        this.settings = settings;
        this.voiceSender = voiceSender;
        this.transmitEnabled = transmitEnabled;
        this.spatialProvider = spatialProvider;
    }

    public synchronized void start() {
        if (!running.compareAndSet(false, true)) return;
        long generation = runGeneration.incrementAndGet();
        captureThread = daemon("ProximityVoice-Capture", () -> captureLoop(generation));
        playbackThread = daemon("ProximityVoice-Playback", () -> playbackLoop(generation));
        captureThread.start();
        playbackThread.start();
    }

    public void setVoiceRadius(double radius) {
        if (Double.isFinite(radius) && radius > 0 && radius <= 512) voiceRadius = radius;
    }

    public double voiceRadius() {
        return voiceRadius;
    }

    public double inputLevel() {
        return inputLevel;
    }

    public String lastError() {
        return lastError.get();
    }

    int remoteStreamCount() {
        return remoteStreams.size();
    }

    public void restartDevices() {
        restartRequested.set(true);
        closeLines();
    }

    public void acceptVoice(UUID playerId, byte[] opusFrame) {
        if (playerId == null || opusFrame == null || opusFrame.length == 0
                || opusFrame.length > Protocol.MAX_OPUS_FRAME_BYTES) return;
        RemoteStream existing = remoteStreams.get(playerId);
        if (existing == null && remoteStreams.size() >= MAX_REMOTE_STREAMS) pruneStreams(System.currentTimeMillis(), true);
        if (existing == null && remoteStreams.size() >= MAX_REMOTE_STREAMS) return;
        try {
            RemoteStream stream = remoteStreams.computeIfAbsent(playerId, ignored -> new RemoteStream());
            stream.lastFrameMillis = System.currentTimeMillis();
            stream.jitter.offer(opusFrame);
        } catch (RuntimeException ignored) {
            // A malformed stream must not stop audio for other players.
        }
    }

    public void clearRemoteAudio() {
        remoteStreams.values().forEach(stream -> stream.jitter.clear());
        remoteStreams.clear();
    }

    private void captureLoop(long generation) {
        OpusEncoder encoder;
        try {
            encoder = new OpusEncoder(SAMPLE_RATE, 1, OpusApplication.OPUS_APPLICATION_VOIP);
            encoder.setBitrate(24_000);
            encoder.setComplexity(4);
            encoder.setUseVBR(true);
            encoder.setUseDTX(true);
            encoder.setUseInbandFEC(true);
            encoder.setPacketLossPercent(5);
        } catch (OpusException error) {
            fail("Could not initialize Opus capture: " + error.getMessage(), generation, true);
            return;
        }

        byte[] pcmBytes = new byte[FRAME_SAMPLES * 2];
        short[] pcm = new short[FRAME_SAMPLES];
        byte[] encoded = new byte[Protocol.MAX_OPUS_FRAME_BYTES];
        while (isRunning(generation)) {
            try {
                TargetDataLine line = ensureInputLine(generation);
                if (line == null) break;
                readFully(line, pcmBytes);
                double peak = 0;
                for (int index = 0; index < FRAME_SAMPLES; index++) {
                    short sample = (short) ((pcmBytes[index * 2] & 0xff) | (pcmBytes[index * 2 + 1] << 8));
                    pcm[index] = sample;
                    peak = Math.max(peak, Math.abs((double) sample) / Short.MAX_VALUE);
                }
                inputLevel = inputLevel * 0.72 + peak * 0.28;
                if (!transmitEnabled.getAsBoolean()) continue;
                int encodedLength = encoder.encode(pcm, 0, FRAME_SAMPLES, encoded, 0, encoded.length);
                if (encodedLength > 0) voiceSender.accept(Arrays.copyOf(encoded, encodedLength));
            } catch (LineUnavailableException error) {
                if (!isRunning(generation)) break;
                fail("Microphone unavailable: " + error.getMessage(), generation, true);
                pauseBeforeRetry();
            } catch (OpusException | RuntimeException error) {
                if (!isRunning(generation)) break;
                fail("Microphone pipeline error: " + error.getMessage(), generation, true);
                pauseBeforeRetry();
            }
        }
    }

    private void playbackLoop(long generation) {
        int[] mix = new int[FRAME_SAMPLES * 2];
        short[] decoded = new short[FRAME_SAMPLES * 6];
        byte[] output = new byte[FRAME_SAMPLES * 4];
        while (isRunning(generation)) {
            try {
                SourceDataLine line = ensureOutputLine(generation);
                if (line == null) break;
                Arrays.fill(mix, 0);
                long now = System.currentTimeMillis();
                for (Map.Entry<UUID, RemoteStream> entry : remoteStreams.entrySet()) {
                    UUID playerId = entry.getKey();
                    RemoteStream stream = entry.getValue();
                    byte[] frame = stream.jitter.poll();
                    if (frame == null) continue;
                    ClientSettings.PlayerAudio playerAudio = settings.playerAudio(playerId);
                    if (playerAudio.muted()) continue;
                    int decodedSamples;
                    try {
                        decodedSamples = stream.decoder.decode(frame, 0, frame.length, decoded, 0, decoded.length, false);
                    } catch (OpusException invalidFrame) {
                        continue;
                    }
                    SpatialSnapshot spatial = spatialProvider.apply(playerId);
                    if (spatial == null || !spatial.sameWorld()) continue;
                    SpatialAudio.Gains gains = SpatialAudio.gains(
                            spatial.listenerX(), spatial.listenerY(), spatial.listenerZ(), spatial.listenerYaw(),
                            spatial.sourceX(), spatial.sourceY(), spatial.sourceZ(), voiceRadius,
                            settings.masterVolume(), playerAudio.volume());
                    SpatialAudio.mixMono(decoded, Math.min(decodedSamples, FRAME_SAMPLES), gains, mix);
                }
                int outputBytes = SpatialAudio.writeLittleEndianStereo(mix, FRAME_SAMPLES, output);
                line.write(output, 0, outputBytes);
                if ((now & 0x3ff) < FRAME_MILLIS) pruneStreams(now, false);
            } catch (LineUnavailableException error) {
                if (!isRunning(generation)) break;
                fail("Speakers unavailable: " + error.getMessage(), generation, false);
                pauseBeforeRetry();
            } catch (RuntimeException error) {
                if (!isRunning(generation)) break;
                fail("Playback pipeline error: " + error.getMessage(), generation, false);
                pauseBeforeRetry();
            }
        }
    }

    private TargetDataLine ensureInputLine(long generation) throws LineUnavailableException {
        if (!isRunning(generation)) return null;
        TargetDataLine current = inputLine;
        if (current != null && current.isOpen() && !restartRequested.get()) return current;
        synchronized (this) {
            if (!isRunning(generation)) return null;
            current = inputLine;
            if (current == null || !current.isOpen() || restartRequested.getAndSet(false)) {
                closeInputLine();
                current = AudioDeviceCatalog.openInput(settings.inputDevice());
                try {
                    current.start();
                } catch (RuntimeException error) {
                    try { current.close(); } catch (RuntimeException ignored) {}
                    throw error;
                }
                inputLine = current;
                lastError.set("");
            }
            return current;
        }
    }

    private SourceDataLine ensureOutputLine(long generation) throws LineUnavailableException {
        if (!isRunning(generation)) return null;
        SourceDataLine current = outputLine;
        if (current != null && current.isOpen() && !restartRequested.get()) return current;
        synchronized (this) {
            if (!isRunning(generation)) return null;
            current = outputLine;
            if (current == null || !current.isOpen() || restartRequested.getAndSet(false)) {
                closeOutputLine();
                current = AudioDeviceCatalog.openOutput(settings.outputDevice());
                try {
                    current.start();
                } catch (RuntimeException error) {
                    try { current.close(); } catch (RuntimeException ignored) {}
                    throw error;
                }
                outputLine = current;
                lastError.set("");
            }
            return current;
        }
    }

    private static void readFully(TargetDataLine line, byte[] buffer) {
        int offset = 0;
        while (offset < buffer.length) {
            int count = line.read(buffer, offset, buffer.length - offset);
            if (count <= 0) throw new IllegalStateException("Microphone stopped");
            offset += count;
        }
    }

    private void pruneStreams(long now, boolean aggressive) {
        long maximumAge = aggressive ? 5_000L : 30_000L;
        remoteStreams.entrySet().removeIf(entry -> now - entry.getValue().lastFrameMillis > maximumAge);
    }

    private synchronized void fail(String message, long generation, boolean captureFailure) {
        if (!isRunning(generation)) return;
        String clean = String.valueOf(message == null ? "Audio unavailable" : message)
                .replaceAll("[\\p{Cntrl}]", " ").trim();
        lastError.set(clean.length() <= 180 ? clean : clean.substring(0, 180));
        if (captureFailure) closeInputLine();
        else closeOutputLine();
    }

    private void pauseBeforeRetry() {
        try {
            Thread.sleep(1_000L);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private static Thread daemon(String name, Runnable task) {
        Thread thread = new Thread(task, name);
        thread.setDaemon(true);
        return thread;
    }

    private boolean isRunning(long generation) {
        return running.get() && runGeneration.get() == generation;
    }

    private synchronized void closeLines() {
        closeInputLine();
        closeOutputLine();
    }

    private void closeInputLine() {
        TargetDataLine line = inputLine;
        inputLine = null;
        if (line != null) {
            try { line.stop(); } catch (RuntimeException ignored) {}
            try { line.close(); } catch (RuntimeException ignored) {}
        }
    }

    private void closeOutputLine() {
        SourceDataLine line = outputLine;
        outputLine = null;
        if (line != null) {
            try { line.stop(); } catch (RuntimeException ignored) {}
            try { line.close(); } catch (RuntimeException ignored) {}
        }
    }

    @Override
    public void close() {
        Thread capture;
        Thread playback;
        long closedGeneration;
        synchronized (this) {
            running.set(false);
            closedGeneration = runGeneration.incrementAndGet();
            closeInputLine();
            closeOutputLine();
            capture = captureThread;
            playback = playbackThread;
            captureThread = null;
            playbackThread = null;
        }
        if (capture != null) capture.interrupt();
        if (playback != null) playback.interrupt();
        join(capture);
        join(playback);
        // A platform audio call that ignored close/interrupt may have completed
        // after the first cleanup. The generation guard prevents it from looping;
        // this second pass closes any line it managed to publish meanwhile.
        synchronized (this) {
            if (runGeneration.get() == closedGeneration && !running.get()) {
                closeInputLine();
                closeOutputLine();
                clearRemoteAudio();
                inputLevel = 0;
            }
        }
    }

    private static void join(Thread thread) {
        if (thread == null || thread == Thread.currentThread()) return;
        try {
            thread.join(1_500L);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private static final class RemoteStream {
        private final FrameJitterBuffer jitter = new FrameJitterBuffer(8, 3);
        private final OpusDecoder decoder;
        private volatile long lastFrameMillis = System.currentTimeMillis();

        private RemoteStream() {
            try {
                decoder = new OpusDecoder(SAMPLE_RATE, 1);
            } catch (OpusException error) {
                throw new IllegalStateException("Could not initialize Opus decoder", error);
            }
        }
    }
}
