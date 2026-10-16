package com.clickinterval.anticheat;

import com.clickinterval.anticheat.core.EnforcementAction;
import com.clickinterval.anticheat.core.CompatibilityPolicy;
import com.clickinterval.anticheat.core.CombatEvidence;
import com.clickinterval.anticheat.core.CombatPatternAnalyzer;
import com.clickinterval.anticheat.core.BehaviorPatternAnalyzer;
import com.clickinterval.anticheat.core.EventLogger;
import com.clickinterval.anticheat.core.FlightEvidence;
import com.clickinterval.anticheat.core.ModDeclaration;
import com.clickinterval.anticheat.core.OffenseRecord;
import com.clickinterval.anticheat.core.OffenseStore;
import com.clickinterval.anticheat.core.RateWindow;
import com.clickinterval.anticheat.core.ReachCheckMath;
import com.clickinterval.anticheat.core.RepeatedMessageGate;
import com.clickinterval.anticheat.core.ProtectionRuntimePolicy;
import com.clickinterval.anticheat.core.ViolationDecision;
import com.clickinterval.anticheat.core.ViolationEngine;
import org.bukkit.BanList;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.player.PlayerVelocityEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.BoundingBox;
import org.bukkit.util.Vector;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/** Event-level checks designed to stay conservative under lag and normal game mechanics. */
public final class ProtectionListener implements Listener {
    private static final int MAX_SESSIONS = 16_384;
    private static final int MAX_LOG_KEYS_PER_SESSION = 32;
    private static final long MOD_DECLARATION_INTERVAL_MILLIS = 1_000L;
    private static final long INVALID_DECLARATION_WARNING_MILLIS = 60_000L;
    private static final long COMPATIBILITY_CACHE_MILLIS = 5_000L;
    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    private final ClickIntervalAntiCheat plugin;
    private final ViolationEngine engine;
    private final OffenseStore offenses;
    private final EventLogger events;
    private final Map<UUID, Session> sessions = new ConcurrentHashMap<>();
    private final Object sessionCreateLock = new Object();
    private volatile ProtectionConfig config;
    private volatile CombatPatternAnalyzer.Settings combatPatternSettings;
    private volatile long lastTpsReadAt;
    private volatile double cachedTps = 20.0;
    private volatile Method tpsMethod;
    private volatile boolean tpsMethodUnavailable;
    private volatile boolean tpsReadReliable;

    public ProtectionListener(
            ClickIntervalAntiCheat plugin,
            ProtectionConfig config,
            ViolationEngine engine,
            OffenseStore offenses,
            EventLogger events
    ) {
        this.plugin = plugin;
        this.config = config;
        this.engine = engine;
        this.offenses = offenses;
        this.events = events;
        this.combatPatternSettings = createCombatPatternSettings(config);
    }

    public void updateConfig(ProtectionConfig config) {
        this.combatPatternSettings = createCombatPatternSettings(config);
        this.config = config;
        engine.clear();
        sessions.clear();
    }

    public void pruneSessions() {
        sessions.entrySet().removeIf(entry -> {
            Player player = Bukkit.getPlayer(entry.getKey());
            return player == null || !player.isOnline();
        });
    }

    public void shutdown() {
        sessions.clear();
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        grace(player, config.joinGraceMillis());
        CompatibilityPolicy.ModPolicy policy = config.compatibility().modPolicy();
        if (policy.enabled() && policy.requireDeclaration()) {
            UUID playerId = player.getUniqueId();
            long delayTicks = policy.declarationGraceSeconds() * 20L;
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                Player online = Bukkit.getPlayer(playerId);
                if (online != null && online.isOnline()) evaluateModPolicy(online);
            }, delayTicks);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onRespawn(PlayerRespawnEvent event) {
        grace(event.getPlayer(), config.teleportGraceMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTeleport(PlayerTeleportEvent event) {
        grace(event.getPlayer(), config.teleportGraceMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onVelocity(PlayerVelocityEvent event) {
        grace(event.getPlayer(), config.velocityGraceMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onGameMode(PlayerGameModeChangeEvent event) {
        grace(event.getPlayer(), config.teleportGraceMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        sessions.remove(event.getPlayer().getUniqueId());
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onLogin(PlayerLoginEvent event) {
        ProtectionConfig current = config;
        OffenseRecord record = offenses.get(event.getPlayer().getUniqueId());
        if (record == null) return;
        if (record.permanentBan()) {
            event.disallow(PlayerLoginEvent.Result.KICK_BANNED,
                    current.messages().loginPermanentBan().render(Map.of(
                            "player", event.getPlayer().getName())));
        } else if (record.temporaryBanUntil() > System.currentTimeMillis()) {
            long remainingMinutes = Math.max(1L, (record.temporaryBanUntil() - System.currentTimeMillis() + 59_999L) / 60_000L);
            event.disallow(PlayerLoginEvent.Result.KICK_BANNED,
                    current.messages().loginTemporaryBan().render(Map.of(
                            "player", event.getPlayer().getName(),
                            "remaining_minutes", remainingMinutes)));
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        ProtectionConfig current = config;
        if (!current.checks().speed() && !current.checks().flight() && !current.checks().phase()
                && !current.checks().invalidPosition() && !current.checks().invalidRotation()
                && !current.checks().groundSpoof() && !current.checks().waterWalk()
                && !current.checks().step() && !current.checks().timer()
                && !current.checks().noSlow()) return;
        Location from = event.getFrom();
        Location to = event.getTo();
        if (to == null || from.getWorld() != to.getWorld()) return;
        Player player = event.getPlayer();
        Session state = session(player);
        long now = System.currentTimeMillis();
        Set<String> compatibility = compatibilityExemptions(player, state, now);
        boolean broadExempt = basicExempt(player);
        if (current.checks().invalidRotation()
                && !compatibility.contains("movement.invalidRotation")
                && !broadExempt && invalidRotation(to)) {
            if (current.responseEnabled()) event.setCancelled(true);
            signal(player, "movement.invalidRotation", "movement", 8.0,
                    "Sent an impossible view rotation",
                    Map.of("yaw", decimal(to.getYaw()), "pitch", decimal(to.getPitch())));
            return;
        }
        if (current.checks().invalidPosition()
                && !compatibility.contains("movement.invalidPosition")
                && !broadExempt && invalidPosition(to)) {
            state.resetMovementEvidence(now);
            if (current.responseEnabled()) event.setCancelled(true);
            signal(player, "movement.invalidPosition", "movement", 4.0,
                    "Sent a non-finite or out-of-bounds position",
                    Map.of(
                            "x", decimal(to.getX()),
                            "y", decimal(to.getY()),
                            "z", decimal(to.getZ())));
            return;
        }
        double dx = to.getX() - from.getX();
        double dy = to.getY() - from.getY();
        double dz = to.getZ() - from.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        long elapsed = state.lastMoveAt == 0L ? 50L : Math.max(1L, now - state.lastMoveAt);
        state.lastMoveAt = now;
        boolean temporarilyExempt = broadExempt || temporarilyExempt(state, now) || elapsed > 500L;
        if (current.checks().timer()) {
            int timerFlags = state.behavior.observeMovementPacket(now,
                    current.limits().maxPacketsPerSecond(), current.limits().timerEvidenceWindows(),
                    temporarilyExempt || compatibility.contains("movement.timer"));
            if ((timerFlags & BehaviorPatternAnalyzer.TIMER) != 0) {
                signal(player, "movement.timer", "movement", 2.0,
                        "Sustained movement packet rate exceeded the normal client clock",
                        Map.of("limit", current.limits().maxPacketsPerSecond(),
                                "windows", current.limits().timerEvidenceWindows()));
            }
        }
        if (temporarilyExempt) {
            state.flightEvidence.reset();
            state.behavior.observeMovement(now, 0.0, 0.0, false, false, false, false,
                    false, true, 0.6, current.limits().maxUseItemBlocksPerTick(),
                    current.limits().groundSpoofSamples(), current.limits().waterWalkSamples(),
                    current.limits().stepSamples(), current.limits().noSlowSamples());
            state.phaseStreak = 0;
            return;
        }

        double elapsedTicks = Math.max(1.0, Math.min(5.0, elapsed / 50.0));
        boolean flightCheck = current.checks().flight()
                && !compatibility.contains("movement.flight");
        boolean speedCheck = current.checks().speed()
                && !compatibility.contains("movement.speed")
                && horizontal > 0.05 && !specialSurface(to);
        // The collision query is the authoritative grounded result for both checks. Compute it
        // once; a client-controlled on-ground bit must not select either movement threshold.
        boolean patternChecks = current.checks().groundSpoof() || current.checks().waterWalk()
                || current.checks().step() || current.checks().noSlow();
        boolean supported = (flightCheck || speedCheck || patternChecks) && serverSideSupport(player, to);
        if (flightCheck) {
            boolean environmentExempt = flightEnvironmentExempt(player, to);
            FlightEvidence.Assessment flight = state.flightEvidence.observe(new FlightEvidence.Sample(
                    dy, Math.max(1, (int) Math.round(elapsedTicks)), player.isOnGround(), supported,
                    environmentExempt), current.limits().maxAirTicks());
            if (flight.report()) {
                String reason = switch (flight.motion()) {
                    case ASCENT -> "Sustained upward movement without natural gravity";
                    case CONTROLLED_DESCENT -> "Sustained controlled descent without natural gravity";
                    case HOVER -> "Stayed airborne without server-side support";
                    default -> "Sustained unsupported movement";
                };
                signal(player, "movement.flight", "movement", 1.5, reason,
                        Map.of(
                                "motion", flight.motion().name().toLowerCase(Locale.ROOT),
                                "evidenceTicks", flight.evidenceTicks(),
                                "verticalPerTick", decimal(flight.verticalPerTick()),
                                "unsupportedGroundClaim", flight.unsupportedGroundClaim()));
            }
        } else {
            state.flightEvidence.reset();
        }

        if (horizontal < 0.001 && Math.abs(dy) < 0.001) return;

        if (patternChecks) {
            AttributeInstance stepAttribute = player.getAttribute(Attribute.STEP_HEIGHT);
            AttributeInstance movementAttribute = player.getAttribute(Attribute.MOVEMENT_SPEED);
            double stepHeight = stepAttribute == null ? 0.6 : stepAttribute.getValue();
            double movementScale = movementAttribute == null ? 1.0
                    : Math.max(1.0, Math.min(8.0, movementAttribute.getValue() / 0.10));
            boolean effectExempt = player.hasPotionEffect(PotionEffectType.JUMP_BOOST)
                    || player.hasPotionEffect(PotionEffectType.LEVITATION)
                    || player.hasPotionEffect(PotionEffectType.SLOW_FALLING)
                    || specialSolidSurface(to);
            int patternFlags = state.behavior.observeMovement(now,
                    dy / elapsedTicks, horizontal / elapsedTicks, player.isOnGround(), supported,
                    liquidBelow(to), liquidAt(to), player.isHandRaised(), effectExempt,
                    stepHeight, current.limits().maxUseItemBlocksPerTick() * movementScale,
                    current.limits().groundSpoofSamples(), current.limits().waterWalkSamples(),
                    current.limits().stepSamples(), current.limits().noSlowSamples());
            if (current.checks().groundSpoof()
                    && (patternFlags & BehaviorPatternAnalyzer.GROUND_SPOOF) != 0
                    && !compatibility.contains("movement.groundSpoof")) {
                signal(player, "movement.groundSpoof", "movement", 2.0,
                        "Repeated client ground claims had no server-side support",
                        Map.of("samples", current.limits().groundSpoofSamples()));
            }
            if (current.checks().waterWalk()
                    && (patternFlags & BehaviorPatternAnalyzer.WATER_WALK) != 0
                    && !compatibility.contains("movement.waterWalk")) {
                signal(player, "movement.waterWalk", "movement", 2.0,
                        "Sustained unsupported movement across a liquid surface",
                        Map.of("samples", current.limits().waterWalkSamples()));
            }
            if (current.checks().step()
                    && (patternFlags & BehaviorPatternAnalyzer.STEP) != 0
                    && !compatibility.contains("movement.step")) {
                signal(player, "movement.step", "movement", 2.2,
                        "Repeatedly climbed higher than the server step-height attribute",
                        Map.of("allowedStep", decimal(stepHeight), "vertical", decimal(dy / elapsedTicks)));
            }
            if (current.checks().noSlow()
                    && (patternFlags & BehaviorPatternAnalyzer.NO_SLOW) != 0
                    && !compatibility.contains("movement.noSlow")) {
                signal(player, "movement.noSlow", "movement", 1.8,
                        "Repeated full-speed movement while using a slowing item",
                        Map.of("samples", current.limits().noSlowSamples(),
                                "observed", decimal(horizontal / elapsedTicks)));
            }
        }

        if (speedCheck) {
            double allowed = ProtectionRuntimePolicy.horizontalMovementLimit(supported,
                    current.limits().maxGroundBlocksPerTick(),
                    current.limits().maxAirBlocksPerTick());
            PotionEffect speed = player.getPotionEffect(PotionEffectType.SPEED);
            if (speed != null) allowed *= 1.0 + 0.22 * (speed.getAmplifier() + 1);
            allowed += Math.min(0.22, player.getPing() / 1000.0);
            double observed = horizontal / elapsedTicks;
            if (observed > allowed) {
                signal(player, "movement.speed", "movement",
                        0.8 + Math.min(3.0, (observed - allowed) * 4.0),
                        "Moved " + decimal(observed) + " blocks/tick; allowed " + decimal(allowed),
                        Map.of("observed", decimal(observed), "allowed", decimal(allowed), "ping", player.getPing()));
            }
        }

        if (current.checks().phase() && !compatibility.contains("movement.phase")) {
            boolean fromPassable = passable(from);
            boolean blocked = !passable(to) && !passableAtOffset(to, 1);
            if (fromPassable && blocked && horizontal + Math.abs(dy) > 0.12) {
                state.phaseStreak++;
                if (state.phaseStreak >= current.limits().phaseSamples()) {
                    signal(player, "movement.phase", "movement", 2.5,
                            "Moved through multiple solid collision blocks",
                            Map.of("streak", state.phaseStreak));
                    state.phaseStreak = 0;
                }
            } else {
                state.phaseStreak = 0;
            }
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onAttack(EntityDamageByEntityEvent event) {
        if (!(event.getDamager() instanceof Player player)) return;
        // Sweep attacks damage secondary entities the player never targeted. Treating those
        // secondary hits as direct attacks can produce impossible-looking reach and CPS data.
        if (event.getCause() != EntityDamageEvent.DamageCause.ENTITY_ATTACK) return;
        ProtectionConfig current = config;
        if (basicExempt(player)) return;
        Session state = session(player);
        long now = System.currentTimeMillis();
        Set<String> compatibility = compatibilityExemptions(player, state, now);

        boolean temporarilyExempt = temporarilyExempt(state, now);
        if (current.checks().autoClicker() && !compatibility.contains("combat.autoClicker")) {
            int cps = state.attacks(current.limits().maxCps()).addAndCount(now, 1_000L);
            if (cps > current.limits().maxCps()) {
                signal(player, "combat.autoClicker", "combat", 0.9 + (cps - current.limits().maxCps()) * 0.15,
                        "Attack rate reached " + cps + " clicks per second",
                        Map.of("cps", cps, "limit", current.limits().maxCps()));
            }
        }

        Entity target = event.getEntity();
        if (current.checks().criticals() && !temporarilyExempt
                && !compatibility.contains("combat.criticals")) {
            float fallDistance = player.getFallDistance();
            Location attackLocation = player.getLocation();
            boolean impossibleCritical = !player.isOnGround()
                    && fallDistance > 0.0f && fallDistance <= 0.085f
                    && serverSideSupport(player, attackLocation)
                    && !flightEnvironmentExempt(player, attackLocation);
            int flags = state.behavior.observeCritical(now, impossibleCritical,
                    current.limits().criticalSamples(), current.limits().criticalWindowMillis());
            if ((flags & BehaviorPatternAnalyzer.CRITICALS) != 0) {
                signal(player, "combat.criticals", "combat", 2.4,
                        "Repeated critical attacks used an unsupported micro-fall state",
                        Map.of("fallDistance", decimal(fallDistance),
                                "samples", current.limits().criticalSamples()));
            }
        }
        if (!temporarilyExempt && target.getWorld() == player.getWorld()
                && (current.checks().aimDirection() || current.checks().killAura()
                || current.checks().clickPattern())) {
            try {
                Location eye = player.getEyeLocation();
                Vector direction = eye.getDirection();
                BoundingBox bounds = target.getBoundingBox();
                CombatPatternAnalyzer.Result pattern = state.combatPatterns.observe(
                        target.getUniqueId(), now,
                        eye.getX(), eye.getY(), eye.getZ(),
                        direction.getX(), direction.getY(), direction.getZ(),
                        bounds.getMinX(), bounds.getMinY(), bounds.getMinZ(),
                        bounds.getMaxX(), bounds.getMaxY(), bounds.getMaxZ(),
                        combatPatternSettings);
                if (current.checks().aimDirection() && pattern.has(CombatPatternAnalyzer.AIM_DIRECTION)
                        && !compatibility.contains("combat.aimDirection")) {
                    signal(player, "combat.aimDirection", "combat", 2.2,
                            "Repeated attacks while view direction missed the target hitbox",
                            Map.of("deviationDegrees", decimal(pattern.aimDeviationDegrees()),
                                    "target", target.getType().name()));
                }
                if (current.checks().killAura() && pattern.has(CombatPatternAnalyzer.RAPID_SWITCH)
                        && !compatibility.contains("combat.killAura")) {
                    signal(player, "combat.killAura", "combat", 3.0,
                            "Repeated implausibly fast wide-angle target switches",
                            Map.of("switchAngleDegrees", decimal(pattern.switchAngleDegrees()),
                                    "windowMillis", current.limits().rapidSwitchMillis()));
                }
                if (current.checks().clickPattern() && pattern.has(CombatPatternAnalyzer.CLICK_PATTERN)
                        && !compatibility.contains("combat.clickPattern")) {
                    signal(player, "combat.clickPattern", "combat", 1.8,
                            "Attack timing remained unnaturally identical across a long sample",
                            Map.of("samples", current.limits().clickPatternSamples(),
                                    "deviationMillis", decimal(pattern.clickIntervalDeviationMillis())));
                }
            } catch (RuntimeException invalidPatternGeometry) {
                state.combatPatterns.reset();
            }
        } else if (temporarilyExempt) {
            state.combatPatterns.reset();
        }
        if (current.checks().multiTarget() && !temporarilyExempt
                && !compatibility.contains("combat.multiTarget")) {
            int distinctTargets = state.combatEvidence.rememberTarget(
                    target.getUniqueId(), now, current.limits().multiTargetWindowMillis());
            if (distinctTargets >= current.limits().multiTargetCount()) {
                signal(player, "combat.multiTarget", "combat", 1.4,
                        "Attacked " + distinctTargets + " different targets in "
                                + current.limits().multiTargetWindowMillis() + "ms",
                        Map.of(
                                "distinctTargets", distinctTargets,
                                "limit", current.limits().multiTargetCount(),
                                "windowMillis", current.limits().multiTargetWindowMillis()));
                state.combatEvidence.clearTargets();
            }
        }

        boolean checkReach = current.checks().reach()
                && !compatibility.contains("combat.reach");
        boolean checkWallHit = current.checks().wallHit()
                && !compatibility.contains("combat.wallHit");
        if ((checkReach || checkWallHit) && target.getWorld() == player.getWorld()) {
            if (temporarilyExempt) {
                state.reachEvidence.reset();
                state.combatEvidence.clearWallEvidence();
            } else {
                try {
                    Location eye = player.getEyeLocation();
                    BoundingBox bounds = target.getBoundingBox();
                    Vector velocity = target.getVelocity();
                    AttributeInstance rangeAttribute = player.getAttribute(Attribute.ENTITY_INTERACTION_RANGE);
                    double serverInteractionRange = rangeAttribute == null ? 0.0 : rangeAttribute.getValue();
                    ReachCheckMath.Parameters reachParameters = current.reach().parameters();
                    ReachCheckMath.Assessment reach = ReachCheckMath.assess(
                            new ReachCheckMath.Point(eye.getX(), eye.getY(), eye.getZ()),
                            new ReachCheckMath.Box(
                                    bounds.getMinX(), bounds.getMinY(), bounds.getMinZ(),
                                    bounds.getMaxX(), bounds.getMaxY(), bounds.getMaxZ()),
                            new ReachCheckMath.Point(velocity.getX(), velocity.getY(), velocity.getZ()),
                            current.limits().maxReach(), serverInteractionRange, player.getPing(), tps(),
                            reachParameters);
                    boolean confirmedReach = checkReach
                            && state.reachEvidence.observe(reach, reachParameters, now);
                    boolean confirmedWallHit = false;
                    if (!checkReach) state.reachEvidence.reset();
                    if (confirmedReach) {
                        // A borderline first sample remains untouched. Only the shared evidence
                        // gate's repeated or clearly impossible result can cancel an actual hit.
                        signal(player, "combat.reach", "combat",
                                1.0 + Math.min(4.0, reach.excess() * 3.0),
                                "Attack reach was " + decimal(reach.observed()) + " blocks; allowed "
                                        + decimal(reach.allowed()),
                                Map.of(
                                        "observed", decimal(reach.observed()),
                                        "allowed", decimal(reach.allowed()),
                                        "ping", player.getPing(),
                                        "target", target.getType().name(),
                                        "hitCancelled", current.responseEnabled()));
                    }

                    if (checkWallHit) {
                        boolean hasLineOfSight;
                        try {
                            hasLineOfSight = player.hasLineOfSight(target);
                        } catch (RuntimeException unavailable) {
                            hasLineOfSight = true; // geometry errors fail open
                        }
                        if (state.combatEvidence.observeWallHit(
                                target.getUniqueId(), hasLineOfSight, reach.observed(), now,
                                current.limits().wallHitSamples(), reachParameters.evidenceWindowMillis())) {
                            confirmedWallHit = true;
                            signal(player, "combat.wallHit", "combat", 1.6,
                                    "Repeated melee attacks without server-visible line of sight",
                                    Map.of(
                                            "samples", current.limits().wallHitSamples(),
                                            "observed", decimal(reach.observed()),
                                            "target", target.getType().name()));
                        }
                    } else {
                        state.combatEvidence.clearWallEvidence();
                    }
                    if (ProtectionRuntimePolicy.shouldCancelSpatialAttack(
                            current.responseEnabled(), confirmedReach, confirmedWallHit)) {
                        event.setCancelled(true);
                    }
                } catch (RuntimeException invalidGeometry) {
                    // Entity geometry can disappear during plugin-driven lifecycle changes. Do not
                    // cancel or punish when the server could not produce a valid assessment.
                    state.reachEvidence.reset();
                    state.combatEvidence.clearWallEvidence();
                }
            }
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        ProtectionConfig current = config;
        if (!current.checks().fastBreak() && !current.checks().multiBreak()
                && !current.checks().breakReach()) return;
        if (basicExempt(player) || player.getGameMode() == GameMode.CREATIVE) return;
        Session state = session(player);
        long now = System.currentTimeMillis();
        Set<String> compatibility = compatibilityExemptions(player, state, now);
        if (current.checks().fastBreak() && !compatibility.contains("world.fastBreak")) {
            int count = state.breaks(current.limits().maxBreaksPerSecond()).addAndCount(now, 1_000L);
            if (count > current.limits().maxBreaksPerSecond()) {
                signal(player, "world.fastBreak", "world", 0.8 + (count - current.limits().maxBreaksPerSecond()) * 0.2,
                        "Broke " + count + " blocks in one second",
                        Map.of("count", count, "limit", current.limits().maxBreaksPerSecond()));
            }
        }
        if (current.checks().multiBreak() && !compatibility.contains("world.multiBreak")) {
            Block block = event.getBlock();
            int flags = state.behavior.observeBreak(now,
                    block.getX() + 0.5, block.getY() + 0.5, block.getZ() + 0.5,
                    current.limits().multiBreakSamples(), current.limits().multiBreakWindowMillis(),
                    current.limits().multiBreakMinSpan());
            if ((flags & BehaviorPatternAnalyzer.MULTI_BREAK) != 0) {
                signal(player, "world.multiBreak", "world", 3.0,
                        "Broke an implausibly wide cluster of blocks in one short window",
                        Map.of("samples", current.limits().multiBreakSamples(),
                                "windowMillis", current.limits().multiBreakWindowMillis()));
            }
        }
        if (current.checks().breakReach() && !compatibility.contains("world.breakReach")) {
            reportBlockReach(player, event.getBlock(), "world.breakReach", "Broke");
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        ProtectionConfig current = config;
        if (!current.checks().fastPlace() && !current.checks().scaffold()
                && !current.checks().placeReach()) return;
        if (basicExempt(player) || player.getGameMode() == GameMode.CREATIVE) return;
        Session state = session(player);
        long now = System.currentTimeMillis();
        Set<String> compatibility = compatibilityExemptions(player, state, now);
        if (current.checks().fastPlace() && !compatibility.contains("world.fastPlace")) {
            int count = state.places(current.limits().maxPlacesPerSecond()).addAndCount(now, 1_000L);
            if (count > current.limits().maxPlacesPerSecond()) {
                signal(player, "world.fastPlace", "world", 0.9 + (count - current.limits().maxPlacesPerSecond()) * 0.2,
                        "Placed " + count + " blocks in one second",
                        Map.of("count", count, "limit", current.limits().maxPlacesPerSecond()));
            }
        }
        if (current.checks().scaffold() && !compatibility.contains("world.scaffold")) {
            double deviation = blockAimDeviation(player, event.getBlockPlaced());
            boolean beneath = event.getBlockPlaced().getY() + 1.01 <= player.getLocation().getY();
            boolean implausible = beneath && deviation > current.limits().scaffoldAimDegrees();
            int flags = state.behavior.observeScaffold(now, implausible,
                    current.limits().scaffoldSamples(), current.limits().scaffoldWindowMillis());
            if ((flags & BehaviorPatternAnalyzer.SCAFFOLD) != 0) {
                signal(player, "world.scaffold", "world", 2.2,
                        "Repeated beneath-player placements were far outside the server-visible aim direction",
                        Map.of("deviationDegrees", decimal(deviation),
                                "samples", current.limits().scaffoldSamples()));
            }
        }
        if (current.checks().placeReach() && !compatibility.contains("world.placeReach")) {
            reportBlockReach(player, event.getBlockPlaced(), "world.placeReach", "Placed");
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onChat(AsyncPlayerChatEvent event) {
        ProtectionConfig current = config;
        Player player = event.getPlayer();
        if (!current.checks().chatSpam() || basicExempt(player)) return;
        Session state = session(player);
        long now = System.currentTimeMillis();
        if (compatibilityExemptions(player, state, now).contains("abuse.chatSpam")) return;
        int count = state.chat(current.limits().maxChatPerFiveSeconds()).addAndCount(now, 5_000L);
        String normalized = normalize(event.getMessage());
        boolean repeated = state.isRepeatedMessage(normalized, now);
        if (count > current.limits().maxChatPerFiveSeconds() || repeated) {
            if (ProtectionRuntimePolicy.shouldCancelDetectedAction(current.responseEnabled(), true)) {
                event.setCancelled(true);
            }
            signal(player, "abuse.chatSpam", "abuse", repeated ? 1.5 : 1.0,
                    repeated ? "Repeated the same chat message" : "Sent " + count + " messages in five seconds",
                    Map.of("count", count, "repeated", repeated));
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        ProtectionConfig current = config;
        Player player = event.getPlayer();
        if (!current.checks().commandSpam() || basicExempt(player)) return;
        Session state = session(player);
        long now = System.currentTimeMillis();
        if (compatibilityExemptions(player, state, now).contains("abuse.commandSpam")) return;
        int count = state.commands(current.limits().maxCommandsPerFiveSeconds()).addAndCount(now, 5_000L);
        if (count > current.limits().maxCommandsPerFiveSeconds()) {
            if (ProtectionRuntimePolicy.shouldCancelDetectedAction(current.responseEnabled(), true)) {
                event.setCancelled(true);
            }
            signal(player, "abuse.commandSpam", "abuse", 1.0,
                    "Sent " + count + " commands in five seconds",
                    Map.of("count", count, "limit", current.limits().maxCommandsPerFiveSeconds()));
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onInventory(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;
        ProtectionConfig current = config;
        if (!current.checks().inventorySpam() || basicExempt(player)) return;
        Session state = session(player);
        long now = System.currentTimeMillis();
        if (compatibilityExemptions(player, state, now).contains("abuse.inventorySpam")) return;
        int count = state.inventory(current.limits().maxInventoryClicksPerSecond()).addAndCount(now, 1_000L);
        if (count > current.limits().maxInventoryClicksPerSecond()) {
            if (ProtectionRuntimePolicy.shouldCancelDetectedAction(current.responseEnabled(), true)) {
                event.setCancelled(true);
            }
            signal(player, "abuse.inventorySpam", "abuse", 0.8,
                    "Clicked inventory " + count + " times in one second",
                    Map.of("count", count, "limit", current.limits().maxInventoryClicksPerSecond()));
        }
    }

    private void signal(
            Player player,
            String check,
            String category,
            double weight,
            String reason,
            Map<String, ?> details
    ) {
        if (compatibilityExempt(player, check)) return;
        UUID playerId = player.getUniqueId();
        int priorOffenses = offenses.priorOffenseCount(playerId, config.policy().offenseDecayMillis());
        ViolationDecision decision = engine.report(
                playerId, check, weight, priorOffenses, config.policy(), config.responseEnabled());
        long now = System.currentTimeMillis();
        Session state = session(player);
        boolean actionEvent = decision.action() != EnforcementAction.NONE;
        if (!state.acquireLogSlot(check, now, actionEvent)) {
            if (config.responseEnabled() && config.preThresholdAction().equals("warn")) {
                warnBeforeThreshold(player, check, reason);
            }
            return;
        }

        OffenseRecord after = offenses.observe(playerId, player.getName(), check, reason);
        if (decision.countsAsOffense()) {
            after = offenses.punish(playerId, decision.action(), decision.durationSeconds(), true);
        }
        events.event(
                player.getName(), playerId, check, category, decision.action(), reason,
                decision.violations(), after.offenseCount(), decision.durationSeconds(), details);
        if (actionEvent) {
            enforce(player, check, decision, reason, after.offenseCount());
        } else if (config.responseEnabled() && config.preThresholdAction().equals("warn")) {
            warnBeforeThreshold(player, check, reason);
        }
    }

    private void enforce(
            Player player,
            String check,
            ViolationDecision decision,
            String reason,
            int offenseCount
    ) {
        ProtectionConfig current = config;
        Map<String, ?> values = Map.of(
                "player", player.getName(),
                "check", check,
                "reason", reason,
                "violations", decimal(decision.violations()),
                "offenses", offenseCount,
                "duration_seconds", decision.durationSeconds(),
                "duration_minutes", Math.max(0L, (decision.durationSeconds() + 59L) / 60L),
                "action", decision.action().wireName()
        );
        Runnable action = () -> {
            if (decision.action() == EnforcementAction.ALERT) {
                player.sendMessage(current.messages().alert().render(values));
                return;
            }
            if (decision.action() == EnforcementAction.KICK) {
                player.kickPlayer(current.messages().kick().render(values));
            } else if (decision.action() == EnforcementAction.TEMP_BAN) {
                String message = current.messages().temporaryBan().render(values);
                Date expiration = Date.from(Instant.now().plusSeconds(decision.durationSeconds()));
                Bukkit.getBanList(BanList.Type.NAME).addBan(
                        player.getName(), message, expiration, current.messages().banSource());
                player.kickPlayer(message);
            } else if (decision.action() == EnforcementAction.PERMANENT_BAN) {
                String message = current.messages().permanentBan().render(values);
                Bukkit.getBanList(BanList.Type.NAME).addBan(
                        player.getName(), message, null, current.messages().banSource());
                player.kickPlayer(message);
            }
        };
        if (Bukkit.isPrimaryThread()) action.run();
        else Bukkit.getScheduler().runTask(plugin, action);
    }

    private Session session(Player player) {
        UUID playerId = player.getUniqueId();
        long now = System.currentTimeMillis();
        Session state = sessions.get(playerId);
        if (state == null) {
            synchronized (sessionCreateLock) {
                state = sessions.get(playerId);
                if (state == null) {
                    if (sessions.size() >= MAX_SESSIONS) evictOldestSession();
                    state = new Session(now);
                    sessions.put(playerId, state);
                }
            }
        }
        state.touch(now);
        return state;
    }

    public void receiveModDeclaration(Player player, byte[] payload) {
        Session state = session(player);
        long now = System.currentTimeMillis();
        if (!state.acceptModDeclarationAttempt(now)) return;
        Set<String> mods;
        try {
            mods = ModDeclaration.parse(payload);
        } catch (IllegalArgumentException invalid) {
            if (state.shouldWarnInvalidDeclaration(now)) {
                plugin.getLogger().warning("Ignored invalid client mod declaration from "
                        + player.getName() + ": " + invalid.getMessage());
            }
            return;
        }
        if (state.setModDeclaration(mods)) evaluateModPolicy(player);
    }

    public ModStatus modStatus(Player player) {
        return session(player).modStatus();
    }

    private void evaluateModPolicy(Player player) {
        ProtectionConfig current = config;
        CompatibilityPolicy.ModPolicy policy = current.compatibility().modPolicy();
        if (!policy.enabled()) return;
        Session state = session(player);
        ModStatus status = state.modStatus();
        CompatibilityPolicy.ModDecision decision = policy.evaluate(
                status.declarationReceived(), status.mods());
        if (!decision.violation()) return;
        String signature = decision.type().name() + ":" + decision.modId();
        if (!state.markModPolicyEvent(signature)) return;

        String reason = switch (decision.type()) {
            case MISSING_DECLARATION -> "No compatible client mod declaration was received";
            case BLOCKED_MOD -> "Client declared blocked mod " + decision.modId();
            case NOT_ALLOWED -> "Client declared a mod outside the allowlist: " + decision.modId();
            case ALLOW -> "";
        };
        EnforcementAction action = policy.enforcement() == CompatibilityPolicy.ModEnforcement.KICK
                ? EnforcementAction.KICK : EnforcementAction.ALERT;
        OffenseRecord record = offenses.get(player.getUniqueId());
        events.event(
                player.getName(), player.getUniqueId(), "compatibility.modPolicy", "compatibility",
                action, reason, 0.0, record == null ? 0 : record.offenseCount(), 0,
                Map.of(
                        "declaredMod", decision.modId(),
                        "declarationReceived", status.declarationReceived(),
                        "declarationTrusted", false
                ));
        if (action == EnforcementAction.KICK) {
            String message = current.messages().modPolicyKick().render(Map.of(
                    "player", player.getName(),
                    "check", "compatibility.modPolicy",
                    "reason", reason,
                    "action", action.wireName()
            ));
            Runnable kick = () -> player.kickPlayer(message);
            if (Bukkit.isPrimaryThread()) kick.run();
            else Bukkit.getScheduler().runTask(plugin, kick);
        }
    }

    private boolean compatibilityExempt(Player player, String check) {
        long now = System.currentTimeMillis();
        Session state = session(player);
        return compatibilityExemptions(player, state, now).contains(check);
    }

    private Set<String> compatibilityExemptions(Player player, Session state, long now) {
        Set<String> exemptions = state.cachedCompatibilityExemptions(now);
        if (exemptions == null) {
            exemptions = config.compatibility().exemptionForPlayer(
                    player.getUniqueId(), player.getName(), player::hasPermission);
            state.cacheCompatibilityExemptions(exemptions, now + COMPATIBILITY_CACHE_MILLIS);
        }
        return exemptions;
    }

    private void grace(Player player, long durationMillis) {
        Session state = session(player);
        state.graceUntil = Math.max(state.graceUntil, System.currentTimeMillis() + durationMillis);
        state.resetMovementEvidence(System.currentTimeMillis());
        state.reachEvidence.reset();
        state.combatEvidence.clear();
        state.combatPatterns.reset();
        state.behavior.reset();
    }

    private static CombatPatternAnalyzer.Settings createCombatPatternSettings(ProtectionConfig current) {
        ProtectionConfig.Limits limits = current.limits();
        return new CombatPatternAnalyzer.Settings(
                limits.maxAimDeviationDegrees(), limits.aimEvidenceSamples(), limits.aimEvidenceWindowMillis(),
                limits.rapidSwitchMillis(), limits.rapidSwitchAngleDegrees(), limits.rapidSwitchSamples(),
                limits.rapidSwitchEvidenceWindowMillis(), limits.clickPatternSamples(),
                limits.clickPatternMaxDeviationMillis());
    }

    private void reportBlockReach(Player player, Block block, String check, String verb) {
        try {
            Location eye = player.getEyeLocation();
            BoundingBox bounds = block.getBoundingBox();
            double observed = distanceToBox(eye, bounds);
            AttributeInstance attribute = player.getAttribute(Attribute.BLOCK_INTERACTION_RANGE);
            double base = attribute == null ? 4.5 : attribute.getValue();
            double allowed = Math.max(1.0, base) + config.limits().blockReachAllowance()
                    + Math.min(0.35, player.getPing() * 0.001);
            if (!Double.isFinite(observed) || observed <= allowed) return;
            signal(player, check, "world", 2.5 + Math.min(5.0, observed - allowed),
                    verb + " a block beyond the server interaction range",
                    Map.of("observed", decimal(observed), "allowed", decimal(allowed),
                            "block", block.getType().name(), "ping", player.getPing()));
        } catch (RuntimeException unavailableGeometry) {
            // World/plugin lifecycle changes can invalidate a block between event dispatch and this
            // read. A missing authoritative measurement must fail open.
        }
    }

    private static double distanceToBox(Location point, BoundingBox box) {
        double x = Math.max(box.getMinX(), Math.min(box.getMaxX(), point.getX()));
        double y = Math.max(box.getMinY(), Math.min(box.getMaxY(), point.getY()));
        double z = Math.max(box.getMinZ(), Math.min(box.getMaxZ(), point.getZ()));
        double dx = point.getX() - x;
        double dy = point.getY() - y;
        double dz = point.getZ() - z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private static double blockAimDeviation(Player player, Block block) {
        Location eye = player.getEyeLocation();
        Vector expected = new Vector(block.getX() + 0.5 - eye.getX(), block.getY() + 0.5 - eye.getY(),
                block.getZ() + 0.5 - eye.getZ());
        Vector look = eye.getDirection();
        if (expected.lengthSquared() < 1.0e-9 || look.lengthSquared() < 1.0e-9) return 0.0;
        double cosine = expected.normalize().dot(look.normalize());
        return Math.toDegrees(Math.acos(Math.max(-1.0, Math.min(1.0, cosine))));
    }

    private boolean temporarilyExempt(Session session, long now) {
        return now < session.graceUntil || tps() < config.minimumTps();
    }

    private boolean basicExempt(Player player) {
        GameMode mode = player.getGameMode();
        return !config.enabled()
                || player.hasPermission(config.bypassPermission())
                || player.hasPermission("clickinterval.anticheat.bypass")
                || config.exemptPlayers().contains(player.getName().toLowerCase(Locale.ROOT))
                || mode == GameMode.CREATIVE
                || mode == GameMode.SPECTATOR
                || player.getAllowFlight()
                || player.isInsideVehicle()
                || player.isGliding()
                || player.isRiptiding()
                || player.isSwimming()
                || config.exemptWorlds().contains(player.getWorld().getName().toLowerCase(Locale.ROOT));
    }

    private double tps() {
        long now = System.currentTimeMillis();
        if (now - lastTpsReadAt < 1_000L) return cachedTps;
        lastTpsReadAt = now;
        try {
            Method method = tpsMethod;
            if (method == null && !tpsMethodUnavailable) {
                synchronized (this) {
                    method = tpsMethod;
                    if (method == null && !tpsMethodUnavailable) {
                        try {
                            method = Bukkit.class.getMethod("getTPS");
                            tpsMethod = method;
                        } catch (ReflectiveOperationException unavailable) {
                            tpsMethodUnavailable = true;
                        }
                    }
                }
            }
            if (method == null) {
                tpsReadReliable = false;
                return cachedTps = 20.0;
            }
            double[] values = (double[]) method.invoke(null);
            if (values.length == 0 || !Double.isFinite(values[0])) {
                tpsReadReliable = false;
                cachedTps = 20.0;
            } else {
                tpsReadReliable = true;
                cachedTps = Math.min(20.0, values[0]);
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            tpsReadReliable = false;
            cachedTps = 20.0;
        }
        return cachedTps;
    }

    private static boolean specialSurface(Location location) {
        Material material = location.getWorld().getBlockAt(
                floor(location.getX()), floor(location.getY()) - 1, floor(location.getZ())).getType();
        String name = material.name();
        return name.contains("ICE") || name.contains("SLIME") || name.contains("HONEY")
                || name.contains("SOUL_SAND") || name.contains("BUBBLE") || name.contains("WATER")
                || name.contains("LAVA") || name.contains("SCAFFOLD") || name.contains("VINE")
                || name.contains("LADDER");
    }

    private static boolean specialSolidSurface(Location location) {
        String name = location.getWorld().getBlockAt(
                floor(location.getX()), floor(location.getY()) - 1, floor(location.getZ())).getType().name();
        return name.contains("ICE") || name.contains("SLIME") || name.contains("HONEY")
                || name.contains("SOUL_SAND") || name.contains("SCAFFOLD");
    }

    private static boolean liquidBelow(Location location) {
        return location.getWorld().getBlockAt(floor(location.getX()), floor(location.getY()) - 1,
                floor(location.getZ())).isLiquid();
    }

    private static boolean liquidAt(Location location) {
        int x = floor(location.getX());
        int y = floor(location.getY());
        int z = floor(location.getZ());
        return location.getWorld().getBlockAt(x, y, z).isLiquid()
                || location.getWorld().getBlockAt(x, y + 1, z).isLiquid();
    }

    private static boolean invalidPosition(Location location) {
        if (location.getWorld() == null) return true;
        return invalidCoordinate(location.getX())
                || invalidCoordinate(location.getY())
                || invalidCoordinate(location.getZ())
                || !Float.isFinite(location.getYaw())
                || !Float.isFinite(location.getPitch());
    }

    private static boolean invalidRotation(Location location) {
        return !Float.isFinite(location.getYaw()) || !Float.isFinite(location.getPitch())
                || location.getPitch() < -90.0001f || location.getPitch() > 90.0001f;
    }

    private static boolean invalidCoordinate(double value) {
        return !Double.isFinite(value) || Math.abs(value) > 30_000_100.0;
    }

    private static boolean serverSideSupport(Player player, Location location) {
        if (location.getWorld() == null) return false;
        BoundingBox current = player.getBoundingBox();
        double halfX = Math.max(0.18, Math.min(0.48, current.getWidthX() * 0.5 - 0.025));
        double halfZ = Math.max(0.18, Math.min(0.48, current.getWidthZ() * 0.5 - 0.025));
        // This thin probe follows the actual player footprint and reaches just below the feet.
        // Collision shapes preserve valid support from slabs, stairs, fences and block ledges.
        BoundingBox probe = new BoundingBox(
                location.getX() - halfX, location.getY() - 0.10, location.getZ() - halfZ,
                location.getX() + halfX, location.getY() + 0.055, location.getZ() + halfZ);
        int minX = floor(probe.getMinX());
        int maxX = floor(probe.getMaxX() - 1.0e-7);
        int minY = floor(probe.getMinY());
        int maxY = floor(probe.getMaxY() - 1.0e-7);
        int minZ = floor(probe.getMinZ());
        int maxZ = floor(probe.getMaxZ() - 1.0e-7);
        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    Block block = location.getWorld().getBlockAt(x, y, z);
                    if (!block.isPassable() && block.getCollisionShape().overlaps(probe)) return true;
                }
            }
        }
        return false;
    }

    private static boolean flightEnvironmentExempt(Player player, Location location) {
        if (player.hasPotionEffect(PotionEffectType.LEVITATION)
                || player.hasPotionEffect(PotionEffectType.SLOW_FALLING)) return true;
        for (int yOffset = 0; yOffset <= 1; yOffset++) {
            String name = location.getWorld().getBlockAt(
                    floor(location.getX()), floor(location.getY()) + yOffset,
                    floor(location.getZ())).getType().name();
            if (name.contains("LADDER") || name.contains("VINE") || name.contains("SCAFFOLD")
                    || name.contains("WATER") || name.contains("LAVA") || name.contains("BUBBLE")
                    || name.contains("COBWEB") || name.contains("POWDER_SNOW")) return true;
        }
        return false;
    }

    private static boolean passable(Location location) {
        return location.getBlock().isPassable();
    }

    private static boolean passableAtOffset(Location location, int yOffset) {
        return location.getWorld().getBlockAt(
                floor(location.getX()), floor(location.getY()) + yOffset, floor(location.getZ())).isPassable();
    }

    private static int floor(double value) {
        return (int) Math.floor(value);
    }

    private static String normalize(String value) {
        return WHITESPACE.matcher(value.toLowerCase(Locale.ROOT)).replaceAll(" ").trim();
    }

    private static String decimal(double value) {
        if (!Double.isFinite(value)) return "0.0";
        return Double.toString(Math.round(value * 100.0) / 100.0);
    }

    private void evictOldestSession() {
        UUID oldestId = null;
        long oldestAt = Long.MAX_VALUE;
        for (Map.Entry<UUID, Session> entry : sessions.entrySet()) {
            long touchedAt = entry.getValue().lastTouchedAt();
            if (touchedAt < oldestAt) {
                oldestAt = touchedAt;
                oldestId = entry.getKey();
            }
        }
        if (oldestId != null) sessions.remove(oldestId);
    }

    private void warnBeforeThreshold(Player player, String check, String reason) {
        Session state = session(player);
        long now = System.currentTimeMillis();
        if (now - state.lastPreWarningAt < config.warningCooldownMillis()) return;
        state.lastPreWarningAt = now;
        String message = config.messages().warningFor(check).render(Map.of(
                "player", player.getName(),
                "check", check,
                "reason", reason
        ));
        Runnable warning = () -> player.sendMessage(message);
        if (Bukkit.isPrimaryThread()) warning.run();
        else Bukkit.getScheduler().runTask(plugin, warning);
    }

    private static final class Session {
        private RateWindow attacks;
        private RateWindow breaks;
        private RateWindow places;
        private volatile RateWindow chat;
        private RateWindow commands;
        private RateWindow inventory;
        private final ReachCheckMath.EvidenceGate reachEvidence = new ReachCheckMath.EvidenceGate();
        private final CombatEvidence combatEvidence = new CombatEvidence();
        private final CombatPatternAnalyzer combatPatterns = new CombatPatternAnalyzer();
        private final RepeatedMessageGate repeatedMessages = new RepeatedMessageGate();
        private final FlightEvidence flightEvidence = new FlightEvidence();
        private final BehaviorPatternAnalyzer behavior = new BehaviorPatternAnalyzer();
        private final Map<String, Long> lastLoggedAt = new HashMap<>();
        private long graceUntil;
        private long lastMoveAt;
        private int phaseStreak;
        private long lastPreWarningAt;
        private boolean modDeclarationReceived;
        private Set<String> declaredMods = Set.of();
        private String lastModPolicyEvent = "";
        private volatile long lastTouchedAt;
        private long lastModDeclarationAttemptAt;
        private long lastInvalidDeclarationWarningAt;
        private volatile long compatibilityCacheUntil;
        private volatile Set<String> compatibilityExemptions = Set.of();

        private Session(long now) {
            lastTouchedAt = now;
        }

        private RateWindow attacks(int threshold) {
            if (attacks == null) attacks = new RateWindow(rateWindowCapacity(threshold));
            return attacks;
        }

        private RateWindow breaks(int threshold) {
            if (breaks == null) breaks = new RateWindow(rateWindowCapacity(threshold));
            return breaks;
        }

        private RateWindow places(int threshold) {
            if (places == null) places = new RateWindow(rateWindowCapacity(threshold));
            return places;
        }

        private RateWindow chat(int threshold) {
            RateWindow existing = chat;
            if (existing != null) return existing;
            synchronized (this) {
                if (chat == null) chat = new RateWindow(rateWindowCapacity(threshold));
                return chat;
            }
        }

        private RateWindow commands(int threshold) {
            if (commands == null) commands = new RateWindow(rateWindowCapacity(threshold));
            return commands;
        }

        private RateWindow inventory(int threshold) {
            if (inventory == null) inventory = new RateWindow(rateWindowCapacity(threshold));
            return inventory;
        }

        private static int rateWindowCapacity(int threshold) {
            long required = Math.max(1L, threshold) + 1L;
            return (int) Math.max(2L, Math.min(256L, required));
        }

        private void resetMovementEvidence(long now) {
            lastMoveAt = now;
            flightEvidence.reset();
            phaseStreak = 0;
            behavior.reset();
        }

        private void touch(long now) {
            lastTouchedAt = now;
        }

        private long lastTouchedAt() {
            return lastTouchedAt;
        }

        private synchronized boolean acquireLogSlot(String check, long now, boolean force) {
            long previous = lastLoggedAt.getOrDefault(check, 0L);
            if (!force && now - previous < 1_000L) return false;
            if (!lastLoggedAt.containsKey(check) && lastLoggedAt.size() >= MAX_LOG_KEYS_PER_SESSION) {
                String oldest = null;
                long oldestAt = Long.MAX_VALUE;
                for (Map.Entry<String, Long> entry : lastLoggedAt.entrySet()) {
                    if (entry.getValue() < oldestAt) {
                        oldestAt = entry.getValue();
                        oldest = entry.getKey();
                    }
                }
                if (oldest != null) lastLoggedAt.remove(oldest);
            }
            lastLoggedAt.put(check, now);
            return true;
        }

        private boolean isRepeatedMessage(String normalized, long now) {
            return repeatedMessages.observeNormalized(normalized, now);
        }

        private Set<String> cachedCompatibilityExemptions(long now) {
            return now < compatibilityCacheUntil ? compatibilityExemptions : null;
        }

        private void cacheCompatibilityExemptions(Set<String> exemptions, long until) {
            compatibilityExemptions = Set.copyOf(exemptions);
            compatibilityCacheUntil = until;
        }

        private synchronized boolean acceptModDeclarationAttempt(long now) {
            if (now - lastModDeclarationAttemptAt < MOD_DECLARATION_INTERVAL_MILLIS) return false;
            lastModDeclarationAttemptAt = now;
            return true;
        }

        private synchronized boolean shouldWarnInvalidDeclaration(long now) {
            if (now - lastInvalidDeclarationWarningAt < INVALID_DECLARATION_WARNING_MILLIS) return false;
            lastInvalidDeclarationWarningAt = now;
            return true;
        }

        private synchronized boolean setModDeclaration(Set<String> mods) {
            Set<String> copy = Set.copyOf(mods);
            boolean changed = !modDeclarationReceived || !declaredMods.equals(copy);
            modDeclarationReceived = true;
            declaredMods = copy;
            return changed;
        }

        private synchronized ModStatus modStatus() {
            return new ModStatus(modDeclarationReceived, declaredMods);
        }

        private synchronized boolean markModPolicyEvent(String signature) {
            if (signature.equals(lastModPolicyEvent)) return false;
            lastModPolicyEvent = signature;
            return true;
        }
    }

    public record ModStatus(boolean declarationReceived, Set<String> mods) {
        public ModStatus {
            mods = Set.copyOf(mods);
        }
    }
}
