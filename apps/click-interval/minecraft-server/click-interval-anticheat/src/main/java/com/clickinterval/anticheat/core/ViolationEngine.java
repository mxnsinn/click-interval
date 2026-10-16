package com.clickinterval.anticheat.core;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Small, allocation-light violation accumulator. It deliberately owns no Bukkit state so the
 * escalation and decay behavior can be tested without starting a Minecraft server.
 */
public final class ViolationEngine {
    public static final int DEFAULT_MAX_STATES = 32_768;
    private static final double MAX_SCORE = 1_000_000.0;
    private static final long MIN_ACTION_COOLDOWN_MILLIS = 250L;

    private final Clock clock;
    private final int maxStates;
    private final Map<Key, State> states;

    public ViolationEngine(Clock clock) {
        this(clock, DEFAULT_MAX_STATES);
    }

    ViolationEngine(Clock clock, int maxStates) {
        this.clock = clock;
        this.maxStates = Math.max(16, Math.min(1_000_000, maxStates));
        this.states = new LinkedHashMap<>(256, 0.75f, true);
    }

    public synchronized ViolationDecision report(
            UUID playerId,
            String check,
            double amount,
            int priorOffenseCount,
            ViolationPolicy policy
    ) {
        return report(playerId, check, amount, priorOffenseCount, policy, true);
    }

    public synchronized ViolationDecision report(
            UUID playerId,
            String check,
            double amount,
            int priorOffenseCount,
            ViolationPolicy policy,
            boolean responseEnabled
    ) {
        long now = clock.nowMillis();
        Key key = new Key(Objects.requireNonNull(playerId, "playerId"), boundedCheck(check));
        State state = states.get(key);
        if (state == null) {
            if (states.size() >= maxStates) {
                Iterator<Key> oldest = states.keySet().iterator();
                if (oldest.hasNext()) {
                    oldest.next();
                    oldest.remove();
                }
            }
            state = new State(now);
            states.put(key, state);
        }
        decay(state, now, policy.decayPerSecond());
        double safeAmount = Double.isFinite(amount) ? Math.max(0.0, Math.min(1_000.0, amount)) : 0.0;
        state.score = Math.min(MAX_SCORE, Math.max(0.0, state.score + safeAmount));

        EnforcementAction action = EnforcementAction.NONE;
        boolean countsAsOffense = false;
        if (responseEnabled && now - state.lastActionAt >= Math.max(
                MIN_ACTION_COOLDOWN_MILLIS, policy.actionCooldownMillis())) {
            if (state.score >= policy.kickVl()) {
                int safePriorOffenses = Math.max(0, priorOffenseCount);
                int nextOffense = safePriorOffenses == Integer.MAX_VALUE
                        ? Integer.MAX_VALUE : safePriorOffenses + 1;
                countsAsOffense = true;
                if (nextOffense >= policy.permanentBanOffenses()) {
                    action = EnforcementAction.PERMANENT_BAN;
                } else if (nextOffense >= policy.tempBanOffenses()) {
                    action = EnforcementAction.TEMP_BAN;
                } else if (nextOffense >= policy.kickOffenses()) {
                    action = EnforcementAction.KICK;
                } else {
                    action = EnforcementAction.ALERT;
                }
            } else if (state.score >= policy.alertVl()
                    && (state.lastAction != EnforcementAction.ALERT || state.score >= state.lastActionScore + 2.0)) {
                action = EnforcementAction.ALERT;
            }
        }

        if (action != EnforcementAction.NONE) {
            state.lastActionAt = now;
            state.lastAction = action;
            state.lastActionScore = state.score;
        }
        int durationSeconds = action == EnforcementAction.TEMP_BAN ? policy.tempBanMinutes() * 60 : 0;
        return new ViolationDecision(round(state.score), action, priorOffenseCount, durationSeconds, countsAsOffense);
    }

    public synchronized double score(UUID playerId, String check, ViolationPolicy policy) {
        State state = states.get(new Key(playerId, boundedCheck(check)));
        if (state == null) return 0.0;
        decay(state, clock.nowMillis(), policy.decayPerSecond());
        return round(state.score);
    }

    public synchronized void forgive(UUID playerId) {
        states.keySet().removeIf(key -> key.playerId.equals(playerId));
    }

    public synchronized void clear() {
        states.clear();
    }

    public synchronized void prune(long idleMillis) {
        long before = clock.nowMillis() - Math.max(0, idleMillis);
        Iterator<State> values = states.values().iterator();
        while (values.hasNext()) {
            if (values.next().lastUpdatedAt < before) values.remove();
        }
    }

    public synchronized int size() {
        return states.size();
    }

    private static String boundedCheck(String check) {
        if (check == null) return "";
        return check.length() <= 96 ? check : check.substring(0, 96);
    }

    private static void decay(State state, long now, double perSecond) {
        long elapsed = Math.max(0L, now - state.lastUpdatedAt);
        if (elapsed > 0 && perSecond > 0) {
            state.score = Math.max(0.0, state.score - (elapsed / 1000.0) * perSecond);
        }
        state.lastUpdatedAt = now;
    }

    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private record Key(UUID playerId, String check) {
    }

    private static final class State {
        private double score;
        private long lastUpdatedAt;
        private long lastActionAt = Long.MIN_VALUE / 2;
        private double lastActionScore;
        private EnforcementAction lastAction = EnforcementAction.NONE;

        private State(long now) {
            this.lastUpdatedAt = now;
        }
    }
}
