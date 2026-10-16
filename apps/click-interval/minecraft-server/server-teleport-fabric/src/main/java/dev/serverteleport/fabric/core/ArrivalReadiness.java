package dev.serverteleport.fabric.core;

/** Tracks packet ordering, not a timed immunity/fall grace period. */
public final class ArrivalReadiness {
    public static final long TIMEOUT_MILLIS = 10_000L;
    public enum Step { WAIT_FOR_CHUNKS, SEND_POSITION_BARRIER, WAIT_FOR_ACK, COMPLETE, TIMED_OUT }

    private final long startedAt;
    private boolean barrierSent;
    private boolean complete;

    public ArrivalReadiness(long startedAt) { this.startedAt = startedAt; }

    public Step poll(long now, boolean footprintSent) {
        if (complete) return Step.COMPLETE;
        if (now - startedAt >= TIMEOUT_MILLIS) return Step.TIMED_OUT;
        if (barrierSent) return Step.WAIT_FOR_ACK;
        return footprintSent ? Step.SEND_POSITION_BARRIER : Step.WAIT_FOR_CHUNKS;
    }

    public void barrierSent() { barrierSent = true; }

    /** An initial teleport ACK cannot confirm chunks sent after that initial position. */
    public boolean acknowledge(boolean vanillaPositionAccepted) {
        if (!barrierSent || !vanillaPositionAccepted) return false;
        complete = true;
        return true;
    }
}
