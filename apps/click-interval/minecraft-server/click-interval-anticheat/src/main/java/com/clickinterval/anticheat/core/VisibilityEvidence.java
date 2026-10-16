package com.clickinterval.anticheat.core;

/** Pure bounded hysteresis for the optional player-visibility mitigation. */
public final class VisibilityEvidence {
    public enum Action {
        NONE,
        HIDE,
        SHOW
    }

    private boolean hidden;
    private int blockedSamples;
    private int visibleSamples;
    private long lastTouchedAt;

    public Action observe(boolean blocked, boolean immediateReveal, int hideAfter, int revealAfter, long nowMillis) {
        lastTouchedAt = nowMillis;
        int safeHideAfter = Math.max(2, Math.min(8, hideAfter));
        int safeRevealAfter = Math.max(1, Math.min(4, revealAfter));
        if (immediateReveal) {
            blockedSamples = 0;
            visibleSamples = 0;
            if (!hidden) return Action.NONE;
            hidden = false;
            return Action.SHOW;
        }
        if (blocked) {
            visibleSamples = 0;
            blockedSamples = Math.min(100, blockedSamples + 1);
            if (!hidden && blockedSamples >= safeHideAfter) {
                hidden = true;
                blockedSamples = 0;
                return Action.HIDE;
            }
            return Action.NONE;
        }
        blockedSamples = 0;
        if (!hidden) {
            visibleSamples = 0;
            return Action.NONE;
        }
        visibleSamples = Math.min(100, visibleSamples + 1);
        if (visibleSamples < safeRevealAfter) return Action.NONE;
        hidden = false;
        visibleSamples = 0;
        return Action.SHOW;
    }

    /** Reveals anything hidden when the mitigation cannot safely make a decision. */
    public Action failOpen(long nowMillis) {
        lastTouchedAt = nowMillis;
        blockedSamples = 0;
        visibleSamples = 0;
        if (!hidden) return Action.NONE;
        hidden = false;
        return Action.SHOW;
    }

    public boolean hidden() {
        return hidden;
    }

    public long lastTouchedAt() {
        return lastTouchedAt;
    }
}
