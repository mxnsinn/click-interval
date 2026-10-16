package com.clickinterval.villagertrades.client;

/** Per-screen protocol state only: no global merchant cache or inherited nonce across screens. */
public final class CycleButtonState {
    public static final long COOLDOWN_MILLIS = 550;
    public static final long QUERY_INTERVAL_MILLIS = 1500;
    private final int containerId;
    private boolean queried, queryPending, eligible, pending;
    private long nonce, readyAt, nextQueryAt;

    public CycleButtonState(int containerId) { this.containerId = containerId; }
    /** A missing/temporarily negative reply must not disable this screen for its entire lifetime. */
    public boolean queryIfDue(boolean serverSupported, boolean nativeCandidate, long now) {
        if (!serverSupported || !nativeCandidate || pending || nonce != 0 && eligible
                || queried && now < nextQueryAt) return false;
        queried = true;
        queryPending = true;
        nextQueryAt = now + QUERY_INTERVAL_MILLIS;
        return true;
    }
    public boolean accept(int container, long freshNonce, boolean serverEligible) {
        // The server retains a menu's nonce for eligibility queries. Repeated status is useful only
        // for a query we actually sent; it must never acknowledge/release an outstanding cycle.
        if (!queried || container != containerId || freshNonce == 0
                || freshNonce == nonce && (!queryPending || pending)) return false;
        nonce = freshNonce;
        eligible = serverEligible;
        pending = false;
        queryPending = false;
        return true;
    }
    public static boolean nativeCandidate(int xp, int level, boolean hasOffers, boolean anyUsedOffer) {
        return xp == 0 && level == 1 && hasOffers && !anyUsedOffer;
    }
    public boolean visible(boolean serverSupported, int xp, int level, boolean hasOffers, boolean anyUsedOffer) {
        return queried && nonce != 0 && eligible && serverSupported
                && nativeCandidate(xp, level, hasOffers, anyUsedOffer);
    }
    public boolean enabled(boolean available, boolean emptyPaymentAndCursor, long now) {
        return available && emptyPaymentAndCursor && !pending && !queryPending && now >= readyAt;
    }
    public boolean begin(boolean available, boolean emptyPaymentAndCursor, long now) {
        if (!enabled(available, emptyPaymentAndCursor, now)) return false;
        pending = true;
        readyAt = now + COOLDOWN_MILLIS;
        return true;
    }
    public long nonce() { return nonce; }
    public boolean pending() { return pending; }
}
