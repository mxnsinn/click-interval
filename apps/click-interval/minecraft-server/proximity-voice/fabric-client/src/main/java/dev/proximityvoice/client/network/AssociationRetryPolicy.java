package dev.proximityvoice.client.network;

/**
 * Monotonic, bounded retry schedule for the authenticated UDP association.
 * A new encrypted datagram (and therefore a new sequence number) is used for
 * every attempt; this class only decides when another attempt is due.
 */
final class AssociationRetryPolicy {
    enum Decision {
        WAIT,
        SEND,
        TIMED_OUT
    }

    private final long initialDelayMillis;
    private final long maximumDelayMillis;
    private final long deadlineMillis;
    private final int maximumAttempts;
    private int attempts;
    private long nextAttemptMillis;

    AssociationRetryPolicy(long startedMillis, long initialDelayMillis,
                           long maximumDelayMillis, long timeoutMillis,
                           int maximumAttempts) {
        if (startedMillis < 0L || initialDelayMillis < 1L
                || maximumDelayMillis < initialDelayMillis || timeoutMillis < initialDelayMillis
                || maximumAttempts < 1) {
            throw new IllegalArgumentException("Invalid association retry policy");
        }
        this.initialDelayMillis = initialDelayMillis;
        this.maximumDelayMillis = maximumDelayMillis;
        this.deadlineMillis = saturatedAdd(startedMillis, timeoutMillis);
        this.maximumAttempts = maximumAttempts;
        this.nextAttemptMillis = startedMillis;
    }

    Decision poll(long nowMillis) {
        if (nowMillis < 0L) throw new IllegalArgumentException("nowMillis cannot be negative");
        if (nowMillis >= deadlineMillis) return Decision.TIMED_OUT;
        if (nowMillis < nextAttemptMillis) return Decision.WAIT;
        return attempts >= maximumAttempts ? Decision.TIMED_OUT : Decision.SEND;
    }

    void attempted(long nowMillis) {
        if (attempts >= maximumAttempts) throw new IllegalStateException("Association attempts exhausted");
        attempts++;
        long shift = Math.min(30L, Math.max(0L, attempts - 1L));
        long multiplier = 1L << shift;
        long delay = initialDelayMillis > Long.MAX_VALUE / multiplier
                ? maximumDelayMillis
                : Math.min(maximumDelayMillis, initialDelayMillis * multiplier);
        nextAttemptMillis = Math.min(deadlineMillis, saturatedAdd(nowMillis, delay));
    }

    int attempts() {
        return attempts;
    }

    long nextAttemptMillis() {
        return nextAttemptMillis;
    }

    private static long saturatedAdd(long left, long right) {
        return left > Long.MAX_VALUE - right ? Long.MAX_VALUE : left + right;
    }
}
