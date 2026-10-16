package dev.proximityvoice.client.network;

import dev.proximityvoice.client.core.ClientStateMachine;
import dev.proximityvoice.client.core.ConnectionState;
import dev.proximityvoice.client.protocol.ControlCodec;
import dev.proximityvoice.client.protocol.DecodedPacket;
import dev.proximityvoice.client.protocol.Direction;
import dev.proximityvoice.client.protocol.PacketCodec;
import dev.proximityvoice.client.protocol.PacketEnvelope;
import dev.proximityvoice.client.protocol.PacketType;
import dev.proximityvoice.client.protocol.Protocol;
import org.junit.jupiter.api.Test;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class UdpVoiceClientRecoveryTest {
    @Test
    void duplicateWelcomeCannotCreateAnOverlappingTransportThread() throws Exception {
        ClientStateMachine state = new ClientStateMachine();
        state.beginNegotiation();
        byte[] key = bytes(Protocol.KEY_BYTES, 31);
        byte[] challenge = bytes(Protocol.CHALLENGE_BYTES, 47);
        try (DatagramSocket relay = new DatagramSocket(0, java.net.InetAddress.getLoopbackAddress())) {
            UdpVoiceClient client = new UdpVoiceClient(state, ignored -> {}, () -> {});
            try {
                client.connect(new ControlCodec.Welcome(101L, key, challenge,
                        relay.getLocalPort(), 48.0, "127.0.0.1"), "127.0.0.1");
                long generation = transportGeneration(client).get();
                client.connect(new ControlCodec.Welcome(202L, key, challenge,
                        relay.getLocalPort(), 48.0, "127.0.0.1"), "127.0.0.1");
                assertEquals(generation, transportGeneration(client).get(),
                        "an active transport generation must not be replaced by a duplicate welcome");
            } finally {
                client.close();
            }
        }
    }

    @Test
    void liveTransportRecoversWhenAssociateAndThenAcknowledgementAreDropped() throws Exception {
        byte[] key = bytes(Protocol.KEY_BYTES, 17);
        byte[] challenge = bytes(Protocol.CHALLENGE_BYTES, 91);
        long sessionId = 0x1020_3040_5060_7080L;
        ClientStateMachine state = new ClientStateMachine();
        state.beginNegotiation();
        CountDownLatch associated = new CountDownLatch(1);
        CountDownLatch stopRelay = new CountDownLatch(1);
        AtomicReference<Throwable> relayFailure = new AtomicReference<>();
        List<Long> associationSequences = java.util.Collections.synchronizedList(new ArrayList<>());

        try (DatagramSocket relay = new DatagramSocket(0, java.net.InetAddress.getLoopbackAddress())) {
            relay.setSoTimeout(4_000);
            Thread relayThread = new Thread(() -> {
                PacketCodec codec = new PacketCodec();
                byte[] receiveBuffer = new byte[Protocol.MAX_DATAGRAM_BYTES];
                try {
                    while (associationSequences.size() < 3) {
                        DatagramPacket datagram = new DatagramPacket(receiveBuffer, receiveBuffer.length);
                        relay.receive(datagram);
                        byte[] encoded = Arrays.copyOfRange(datagram.getData(), datagram.getOffset(),
                                datagram.getOffset() + datagram.getLength());
                        PacketEnvelope envelope = codec.readEnvelope(encoded);
                        DecodedPacket packet = codec.decode(envelope, key, Direction.CLIENT_TO_SERVER);
                        if (packet.type() != PacketType.ASSOCIATE) continue;
                        associationSequences.add(packet.sequence());
                        assertArrayEquals(challenge, packet.payload());

                        // Datagram one is lost. Datagram two reaches the relay but its ACK is lost.
                        if (associationSequences.size() < 3) continue;
                        byte[] ack = codec.encode(PacketType.ACK, sessionId, 1L,
                                new byte[]{(byte) PacketType.ASSOCIATE.id()}, key,
                                Direction.SERVER_TO_CLIENT);
                        relay.send(new DatagramPacket(ack, ack.length, datagram.getSocketAddress()));
                    }
                    stopRelay.await(4, TimeUnit.SECONDS);
                } catch (SocketTimeoutException timeout) {
                    relayFailure.set(timeout);
                } catch (Throwable error) {
                    relayFailure.set(error);
                }
            }, "ProximityVoice-TestRelay");
            relayThread.setDaemon(true);
            relayThread.start();

            UdpVoiceClient client = new UdpVoiceClient(state, ignored -> {}, associated::countDown);
            try {
                client.connect(new ControlCodec.Welcome(sessionId, key, challenge,
                        relay.getLocalPort(), 48.0, "127.0.0.1"), "127.0.0.1");
                assertTrue(associated.await(4, TimeUnit.SECONDS), "association retry did not recover");
                assertEquals(ConnectionState.CONNECTED, state.state());
                assertEquals(List.of(1L, 2L, 3L), List.copyOf(associationSequences),
                        "every retransmission must use a fresh authenticated sequence");
                assertNull(relayFailure.get());
            } finally {
                client.close();
                stopRelay.countDown();
                relayThread.join(4_000L);
            }
        }
    }

    private static byte[] bytes(int length, int seed) {
        byte[] result = new byte[length];
        for (int index = 0; index < result.length; index++) result[index] = (byte) (seed + index * 13);
        return result;
    }

    private static AtomicLong transportGeneration(UdpVoiceClient client) throws Exception {
        java.lang.reflect.Field field = UdpVoiceClient.class.getDeclaredField("transportGeneration");
        field.setAccessible(true);
        return (AtomicLong) field.get(client);
    }
}
