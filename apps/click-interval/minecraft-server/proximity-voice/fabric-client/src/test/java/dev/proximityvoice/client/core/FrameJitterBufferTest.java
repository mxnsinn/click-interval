package dev.proximityvoice.client.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class FrameJitterBufferTest {
    @Test
    void waitsForPrebufferAndCopiesInput() {
        FrameJitterBuffer buffer = new FrameJitterBuffer(5, 2);
        byte[] first = {1};
        buffer.offer(first);
        first[0] = 9;
        assertNull(buffer.poll());
        buffer.offer(new byte[]{2});
        assertArrayEquals(new byte[]{1}, buffer.poll());
        assertArrayEquals(new byte[]{2}, buffer.poll());
        assertNull(buffer.poll());
    }

    @Test
    void staysBoundedAndDropsOldestFrame() {
        FrameJitterBuffer buffer = new FrameJitterBuffer(3, 1);
        buffer.offer(new byte[]{1});
        buffer.offer(new byte[]{2});
        buffer.offer(new byte[]{3});
        buffer.offer(new byte[]{4});
        assertEquals(3, buffer.size());
        assertEquals(1, buffer.droppedFrames());
        assertArrayEquals(new byte[]{2}, buffer.poll());
    }
}
