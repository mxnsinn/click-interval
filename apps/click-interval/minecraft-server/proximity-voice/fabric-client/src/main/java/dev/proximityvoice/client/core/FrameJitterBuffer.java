package dev.proximityvoice.client.core;

import java.util.ArrayDeque;
import java.util.Arrays;

/** A small bounded queue that pre-buffers frames after every underrun. */
public final class FrameJitterBuffer {
    private final ArrayDeque<byte[]> frames;
    private final int capacity;
    private final int prebufferFrames;
    private boolean ready;
    private long droppedFrames;

    public FrameJitterBuffer(int capacity, int prebufferFrames) {
        if (capacity < 2 || capacity > 50) throw new IllegalArgumentException("Invalid jitter capacity");
        if (prebufferFrames < 1 || prebufferFrames >= capacity) {
            throw new IllegalArgumentException("Invalid jitter prebuffer");
        }
        this.capacity = capacity;
        this.prebufferFrames = prebufferFrames;
        this.frames = new ArrayDeque<>(capacity);
    }

    public synchronized void offer(byte[] encodedFrame) {
        if (encodedFrame == null || encodedFrame.length == 0) return;
        if (frames.size() == capacity) {
            frames.removeFirst();
            droppedFrames++;
        }
        frames.addLast(Arrays.copyOf(encodedFrame, encodedFrame.length));
        if (frames.size() >= prebufferFrames) ready = true;
    }

    public synchronized byte[] poll() {
        if (!ready) return null;
        byte[] next = frames.pollFirst();
        if (next == null) ready = false;
        return next;
    }

    public synchronized int size() {
        return frames.size();
    }

    public synchronized long droppedFrames() {
        return droppedFrames;
    }

    public synchronized void clear() {
        frames.clear();
        ready = false;
    }
}
