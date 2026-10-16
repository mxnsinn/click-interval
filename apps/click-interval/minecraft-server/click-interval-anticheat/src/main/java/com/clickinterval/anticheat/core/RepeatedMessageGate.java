package com.clickinterval.anticheat.core;

/**
 * Fixed-size evidence gate for repeated normalized chat messages.
 * A message is repeated only on its third consecutive occurrence inside five seconds.
 */
public final class RepeatedMessageGate {
    public static final long WINDOW_MILLIS = 5_000L;
    public static final int REQUIRED_CONSECUTIVE_MESSAGES = 3;

    private String lastMessage = "";
    private long lastMessageAt;
    private int consecutiveMessageCount;

    public synchronized boolean observeNormalized(String normalized, long now) {
        String message = normalized == null ? "" : normalized;
        boolean sameRecentMessage = !message.isEmpty()
                && message.equals(lastMessage)
                && now >= lastMessageAt
                && now - lastMessageAt <= WINDOW_MILLIS;
        consecutiveMessageCount = sameRecentMessage
                ? Math.min(REQUIRED_CONSECUTIVE_MESSAGES, consecutiveMessageCount + 1)
                : 1;
        boolean repeated = sameRecentMessage
                && consecutiveMessageCount >= REQUIRED_CONSECUTIVE_MESSAGES;
        lastMessage = message;
        lastMessageAt = now;
        return repeated;
    }

    public synchronized void reset() {
        lastMessage = "";
        lastMessageAt = 0L;
        consecutiveMessageCount = 0;
    }
}
