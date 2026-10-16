package dev.serverprotection.fabric;

/** Server-observed movement transitions that cannot safely be scored as ordinary walking. */
final class MovementTransitionTracker {
    private static final long UNSET = Long.MIN_VALUE;
    private static final long PACKET_GAP_MILLIS = 250L;
    private static final long RESUME_GRACE_MILLIS = 1_000L;
    private static final long FLIGHT_LANDING_GRACE_MILLIS = 2_500L;

    private long lastPacketAt = UNSET;
    private long resumeGraceUntil;
    private long flightGraceUntil;

    void observePacket(long now) {
        if (lastPacketAt == UNSET || now < lastPacketAt || now - lastPacketAt > PACKET_GAP_MILLIS) {
            resumeGraceUntil = now + RESUME_GRACE_MILLIS;
        }
        lastPacketAt = now;
    }

    boolean exempt(long now, boolean gliding, boolean riptide) {
        // isFallFlying is authoritative server state. Keep its residual momentum exempt during
        // landing, water entry and the tick where the flight flag is cleared.
        if (gliding || riptide) flightGraceUntil = now + FLIGHT_LANDING_GRACE_MILLIS;
        return packetTimingUncertain(now) || now < flightGraceUntil;
    }

    /** Timer evidence must not score delayed packet delivery as an accelerated client clock. */
    boolean packetTimingUncertain(long now) {
        return lastPacketAt == UNSET || now < lastPacketAt
                || now - lastPacketAt > PACKET_GAP_MILLIS
                || now < resumeGraceUntil;
    }
}
