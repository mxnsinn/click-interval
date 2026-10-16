package com.clickinterval.anticheat.core;

public record ViolationPolicy(
        double alertVl,
        double kickVl,
        int kickOffenses,
        int tempBanOffenses,
        int tempBanMinutes,
        int permanentBanOffenses,
        int offenseDecayHours,
        double decayPerSecond,
        long actionCooldownMillis
) {
    public ViolationPolicy {
        if (alertVl <= 0 || kickVl <= alertVl) {
            throw new IllegalArgumentException("kickVl must be greater than alertVl, and both must be positive");
        }
        if (kickOffenses < 1 || tempBanOffenses <= kickOffenses || permanentBanOffenses <= tempBanOffenses) {
            throw new IllegalArgumentException("offense thresholds must increase from kick to temporary to permanent ban");
        }
        if (tempBanMinutes < 1 || offenseDecayHours < 1 || decayPerSecond < 0 || actionCooldownMillis < 0) {
            throw new IllegalArgumentException("invalid duration, decay, or cooldown");
        }
    }

    public static ViolationPolicy balanced() {
        return new ViolationPolicy(8.0, 16.0, 1, 3, 60, 7, 168, 0.12, 8_000L);
    }

    public long offenseDecayMillis() {
        return offenseDecayHours * 60L * 60L * 1000L;
    }
}
