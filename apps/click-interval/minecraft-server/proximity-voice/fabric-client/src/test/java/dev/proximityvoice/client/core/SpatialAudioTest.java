package dev.proximityvoice.client.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SpatialAudioTest {
    @Test
    void silencesSourcesOutsideRadius() {
        SpatialAudio.Gains gains = SpatialAudio.gains(0, 0, 0, 0, 0, 0, 49, 48, 1, 1);
        assertEquals(0.0, gains.left());
        assertEquals(0.0, gains.right());
    }

    @Test
    void centerSourceHasBalancedChannels() {
        SpatialAudio.Gains gains = SpatialAudio.gains(0, 0, 0, 0, 0, 0, 1, 48, 1, 1);
        assertEquals(gains.left(), gains.right(), 1.0e-8);
        assertTrue(gains.left() > 0.6);
    }

    @Test
    void rightwardSourcePansRight() {
        // In Minecraft, facing south (yaw 0) makes west (-X) screen-right.
        SpatialAudio.Gains gains = SpatialAudio.gains(0, 0, 0, 0, -5, 0, 0, 48, 1, 1);
        assertTrue(gains.right() > gains.left());
    }

    @Test
    void mixingSaturatesRatherThanWrapping() {
        int[] accumulator = {100_000, -100_000};
        byte[] pcm = SpatialAudio.toLittleEndianStereo(accumulator, 1);
        assertArrayEquals(new byte[]{(byte) 0xff, 0x7f, 0x00, (byte) 0x80}, pcm);
    }

    @Test
    void writesIntoReusablePlaybackBuffer() {
        byte[] output = new byte[8];
        assertEquals(4, SpatialAudio.writeLittleEndianStereo(
                new int[]{0x1234, -0x1234}, 1, output));
        assertArrayEquals(new byte[]{0x34, 0x12, (byte) 0xcc, (byte) 0xed, 0, 0, 0, 0}, output);
    }
}
