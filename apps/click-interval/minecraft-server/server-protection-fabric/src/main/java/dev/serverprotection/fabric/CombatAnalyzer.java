package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.RateWindow;
import com.clickinterval.anticheat.core.ReachCheckMath;
import com.clickinterval.anticheat.core.CombatPatternAnalyzer;

import java.util.UUID;

/** Fixed-capacity combat evidence. It performs no entity scans and allocates no per-attack collections. */
public final class CombatAnalyzer {
    public static final int REACH = 1;
    public static final int WALL_HIT = 1 << 1;
    public static final int AUTO_CLICKER = 1 << 2;
    public static final int MULTI_TARGET = 1 << 3;
    public static final int AIM_DIRECTION = 1 << 4;
    public static final int RAPID_SWITCH = 1 << 5;
    public static final int CLICK_PATTERN = 1 << 6;
    private static final int TARGET_HISTORY = 16;

    private final RateWindow attackWindow = new RateWindow(64);
    private final ReachCheckMath.EvidenceGate reachGate = new ReachCheckMath.EvidenceGate();
    private final CombatPatternAnalyzer spatialPatterns = new CombatPatternAnalyzer();
    private final CombatPatternAnalyzer clickPatterns = new CombatPatternAnalyzer();
    private final UUID[] targets = new UUID[TARGET_HISTORY];
    private final long[] targetTimes = new long[TARGET_HISTORY];
    private ProtectionConfig.Combat cachedCombatSettings;
    private CombatPatternAnalyzer.Settings cachedPatternSettings;
    private int nextTarget;
    private int wallSamples;
    private UUID wallTarget;
    private long wallFirstSampleAt;

    public Result evaluate(Attack attack, ProtectionConfig config) {
        int flags = 0;
        int cps = attackWindow.addAndCount(attack.nowMillis(), 1_000L);
        if (config.checks().autoClicker() && cps > config.combat().maxCps()) flags |= AUTO_CLICKER;

        int distinctTargets = rememberAndCountTargets(
                attack.targetId(), attack.nowMillis(), config.combat().multiTargetWindowMillis());
        if (config.checks().multiTarget() && distinctTargets >= config.combat().multiTargetCount()) {
            flags |= MULTI_TARGET;
        }

        ReachCheckMath.Assessment reach = ReachCheckMath.assess(
                attack.eye(), attack.targetBox(), attack.targetVelocity(),
                config.combat().maxReach(), attack.serverInteractionRange(),
                attack.pingMillis(), attack.tps(), config.reachParameters());
        if (config.checks().reach()
                && reachGate.observe(reach, config.reachParameters(), attack.nowMillis())) {
            flags |= REACH;
        }

        if (!attack.hasLineOfSight() && reach.observed() > 1.75) {
            if (!attack.targetId().equals(wallTarget) || attack.nowMillis() - wallFirstSampleAt > 1_750L) {
                wallTarget = attack.targetId();
                wallFirstSampleAt = attack.nowMillis();
                wallSamples = 0;
            }
            wallSamples = Math.min(100, wallSamples + 1);
            if (config.checks().wallHit() && wallSamples >= config.combat().wallHitSamples()) {
                flags |= WALL_HIT;
                wallSamples = 0;
            }
        } else {
            wallSamples = 0;
            wallTarget = null;
            wallFirstSampleAt = 0L;
        }
        ReachCheckMath.Point eye = attack.eye();
        ReachCheckMath.Point view = attack.viewDirection();
        ReachCheckMath.Box box = attack.targetBox();
        double aimDeviation = Double.NaN;
        double switchAngle = 0.0;
        if (attack.recentlyTeleportedTarget()) {
            // The closer of the before/current hitboxes makes reach geometry precise, but rotation
            // packet ordering around a teleport is still ambiguous. Reset only spatial patterns.
            spatialPatterns.reset();
        } else {
            CombatPatternAnalyzer.Result spatial = spatialPatterns.observe(
                    attack.targetId(), attack.nowMillis(),
                    eye.x(), eye.y(), eye.z(), view.x(), view.y(), view.z(),
                    box.minX(), box.minY(), box.minZ(), box.maxX(), box.maxY(), box.maxZ(),
                    patternSettings(config.combat()));
            aimDeviation = spatial.aimDeviationDegrees();
            switchAngle = spatial.switchAngleDegrees();
            if (config.checks().aimDirection() && spatial.has(CombatPatternAnalyzer.AIM_DIRECTION)) {
                flags |= AIM_DIRECTION;
            }
            if (config.checks().killAura() && spatial.has(CombatPatternAnalyzer.RAPID_SWITCH)) {
                flags |= RAPID_SWITCH;
            }
        }
        CombatPatternAnalyzer.Result click = clickPatterns.observe(
                attack.targetId(), attack.nowMillis(),
                eye.x(), eye.y(), eye.z(), view.x(), view.y(), view.z(),
                box.minX(), box.minY(), box.minZ(), box.maxX(), box.maxY(), box.maxZ(),
                patternSettings(config.combat()));
        if (config.checks().clickPattern() && click.has(CombatPatternAnalyzer.CLICK_PATTERN)) {
            flags |= CLICK_PATTERN;
        }
        return new Result(flags, cps, distinctTargets, reach.observed(), reach.allowed(), reach.excess(),
                aimDeviation, switchAngle, click.clickIntervalDeviationMillis());
    }

    public void reset() {
        attackWindow.clear();
        reachGate.reset();
        spatialPatterns.reset();
        clickPatterns.reset();
        for (int i = 0; i < TARGET_HISTORY; i++) {
            targets[i] = null;
            targetTimes[i] = 0L;
        }
        nextTarget = 0;
        wallSamples = 0;
        wallTarget = null;
        wallFirstSampleAt = 0L;
        cachedCombatSettings = null;
        cachedPatternSettings = null;
    }

    private CombatPatternAnalyzer.Settings patternSettings(ProtectionConfig.Combat combat) {
        // Config records are immutable and replaced on reload. Cache the translated shared-core
        // settings instead of rebuilding the same record for every attack packet.
        if (combat != cachedCombatSettings || cachedPatternSettings == null) {
            cachedCombatSettings = combat;
            cachedPatternSettings = new CombatPatternAnalyzer.Settings(
                    combat.maxAimDeviationDegrees(), combat.aimEvidenceSamples(),
                    combat.aimEvidenceWindowMillis(), combat.rapidSwitchMillis(),
                    combat.rapidSwitchAngleDegrees(), combat.rapidSwitchSamples(),
                    combat.rapidSwitchEvidenceWindowMillis(), combat.clickPatternSamples(),
                    combat.clickPatternMaxDeviationMillis());
        }
        return cachedPatternSettings;
    }

    private int rememberAndCountTargets(UUID target, long now, long windowMillis) {
        targets[nextTarget] = target;
        targetTimes[nextTarget] = now;
        nextTarget = (nextTarget + 1) % TARGET_HISTORY;
        int distinct = 0;
        long cutoff = now - Math.max(1L, windowMillis);
        for (int i = 0; i < TARGET_HISTORY; i++) {
            UUID candidate = targets[i];
            if (candidate == null || targetTimes[i] < cutoff) continue;
            boolean alreadyCounted = false;
            for (int earlier = 0; earlier < i; earlier++) {
                if (targetTimes[earlier] >= cutoff && candidate.equals(targets[earlier])) {
                    alreadyCounted = true;
                    break;
                }
            }
            if (!alreadyCounted) distinct++;
        }
        return distinct;
    }

    public record Attack(UUID targetId, long nowMillis, int pingMillis, double tps,
                         double serverInteractionRange,
                         boolean hasLineOfSight, ReachCheckMath.Point eye,
                         ReachCheckMath.Box targetBox, ReachCheckMath.Point targetVelocity,
                         ReachCheckMath.Point viewDirection, boolean recentlyTeleportedTarget) { }

    public record Result(int flags, int cps, int distinctTargets, double observedReach,
                         double allowedReach, double reachExcess, double aimDeviationDegrees,
                         double switchAngleDegrees, double clickIntervalDeviationMillis) {
        public boolean has(int flag) { return (flags & flag) != 0; }
    }
}
