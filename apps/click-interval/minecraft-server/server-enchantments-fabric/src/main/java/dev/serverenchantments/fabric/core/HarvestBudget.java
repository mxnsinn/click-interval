package dev.serverenchantments.fabric.core;

/** One shared budget for inline and queued work during a single server tick.
 * Elapsed times are supplied by the caller so budget accounting is deterministic to test.
 */
public final class HarvestBudget {
    private final long timeLimitNanos;
    private long timeLeftNanos;
    private int scansLeft;
    private int breaksLeft;

    public HarvestBudget(long timeLimitNanos) {
        if (timeLimitNanos <= 0) throw new IllegalArgumentException("Positive time budget required");
        this.timeLimitNanos = timeLimitNanos;
    }
    public void reset(int scans, int breaks) {
        scansLeft = Math.max(0, scans);
        breaksLeft = Math.max(0, breaks);
        timeLeftNanos = timeLimitNanos;
    }
    public boolean hasTime(long currentDispatchNanos) {
        return timeLeftNanos > Math.max(0, currentDispatchNanos);
    }
    public int scanAllowance(int quantum) { return Math.min(scansLeft, Math.max(0, quantum)); }
    public void consumeScans(int count) {
        if (count < 0 || count > scansLeft) throw new IllegalArgumentException("Scan budget exceeded");
        scansLeft -= count;
    }
    /** Charge even skipped/denied positions, bounding probing as well as successful breaks. */
    public boolean tryBreak() {
        if (breaksLeft <= 0) return false;
        breaksLeft--;
        return true;
    }
    public void chargeNanos(long elapsedNanos) {
        timeLeftNanos -= Math.min(timeLeftNanos, Math.max(0, elapsedNanos));
    }
    public int scansLeft() { return scansLeft; }
    public int breaksLeft() { return breaksLeft; }
    public long timeLeftNanos() { return timeLeftNanos; }
}
