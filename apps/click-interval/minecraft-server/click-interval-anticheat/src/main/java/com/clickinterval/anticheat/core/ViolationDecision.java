package com.clickinterval.anticheat.core;

public record ViolationDecision(
        double violations,
        EnforcementAction action,
        int priorOffenseCount,
        int durationSeconds,
        boolean countsAsOffense
) {
}
