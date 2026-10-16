package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.AccessPolicy;
import com.clickinterval.anticheat.core.BehaviorPatternAnalyzer;
import com.clickinterval.anticheat.core.Clock;
import com.clickinterval.anticheat.core.EnforcementAction;
import com.clickinterval.anticheat.core.EventLogger;
import com.clickinterval.anticheat.core.OffenseRecord;
import com.clickinterval.anticheat.core.OffenseStore;
import com.clickinterval.anticheat.core.ProtectionMessages;
import com.clickinterval.anticheat.core.ReachCheckMath;
import com.clickinterval.anticheat.core.ViolationDecision;
import com.clickinterval.anticheat.core.ViolationEngine;
import com.meowantixray.MeowAntiXrayMod;
import dev.serverprotection.fabric.attestation.AttestationProtocol;
import dev.serverprotection.fabric.attestation.ClientAttestationSessions;
import dev.serverprotection.fabric.attestation.ClientModPolicy;
import dev.serverprotection.fabric.attestation.FabricClientAttestation;
import dev.serverprotection.fabric.playerview.PlayerViewPayload;
import dev.serverprotection.fabric.playerview.PlayerViewReadyPayload;
import dev.servertradeassistant.fabric.control.AppControlBridge;
import com.mojang.brigadier.ParseResults;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.StringReader;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.tree.RootCommandNode;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundCommandSuggestionsPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.server.permissions.PermissionSet;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.DoorBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.DoubleBlockHalf;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.gamerules.GameRules;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** Server-only Fabric adapter. All callbacks execute on the server thread; disk writes do not. */
public final class ServerProtectionFabric implements ModInitializer {
    public static final String MOD_ID = "serverprotection_fabric";
    public static final String[] SUPPORTED_CHECKS = {
            "movement.speed",
            "movement.flight",
            "movement.phase",
            "movement.invalidPosition",
            "movement.invalidRotation",
            "movement.groundSpoof",
            "movement.waterWalk",
            "movement.step",
            "movement.timer",
            "movement.noSlow",
            "combat.reach",
            "combat.wallHit",
            "combat.autoClicker",
            "combat.multiTarget",
            "combat.aimDirection",
            "combat.killAura",
            "combat.clickPattern",
            "combat.criticals",
            "world.fastBreak",
            "world.fastPlace",
            "world.breakReach",
            "world.placeReach",
            "world.scaffold",
            "world.multiBreak",
            "abuse.chatSpam",
            "abuse.commandSpam",
            "abuse.inventorySpam"
    };

    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final int MAX_SESSIONS = 16_384;
    private static final long DETECTION_COOLDOWN_MILLIS = 250L;
    private static final long SESSION_IDLE_MILLIS = 10L * 60L * 1000L;
    private static final long PACKET_FAILURE_LOG_INTERVAL_MILLIS = 30_000L;
    private static final double COLLISION_SCAN_MARGIN = 1.0000001;
    private static final Set<String> VALUABLE_ORES = Set.of(
            "minecraft:ancient_debris", "minecraft:coal_ore", "minecraft:deepslate_coal_ore",
            "minecraft:copper_ore", "minecraft:deepslate_copper_ore",
            "minecraft:diamond_ore", "minecraft:deepslate_diamond_ore",
            "minecraft:emerald_ore", "minecraft:deepslate_emerald_ore",
            "minecraft:gold_ore", "minecraft:deepslate_gold_ore",
            "minecraft:iron_ore", "minecraft:deepslate_iron_ore",
            "minecraft:lapis_ore", "minecraft:deepslate_lapis_ore",
            "minecraft:redstone_ore", "minecraft:deepslate_redstone_ore",
            "minecraft:nether_gold_ore", "minecraft:nether_quartz_ore");
    private static volatile ServerProtectionFabric active;
    private AutomaticHarvestGuard automaticHarvest = AutomaticHarvestGuard.absent();
    private TeleportArrivalGuard teleportArrival = TeleportArrivalGuard.absent();

    private final Path dataDirectory = FabricLoader.getInstance().getConfigDir().resolve("server-protection");
    private final Path configFile = dataDirectory.resolve("config.yml");
    private final Path accessFile = dataDirectory.resolve("access.yml");
    private final LinkedHashMap<UUID, PlayerSession> sessions = new LinkedHashMap<>(256, 0.75f, true);
    private final TickRateMonitor tickRate = new TickRateMonitor();
    private final ViolationEngine violations = new ViolationEngine(Clock.SYSTEM);
    private final AtomicBoolean saveQueued = new AtomicBoolean();
    private final AtomicLong lastPacketFailureLogAt = new AtomicLong();
    private final FabricAccessPolicy accessPolicy = new FabricAccessPolicy();
    private final AntiCheatExemptionStore antiCheatExemptions = new AntiCheatExemptionStore(
            dataDirectory.resolve("anticheat-exemptions.tsv"));
    private final PacketAntiXrayExemptionGate packetAntiXrayExemptions =
            new PacketAntiXrayExemptionGate(antiCheatExemptions::contains);
    private final FabricClientAttestation clientAttestation =
            new FabricClientAttestation(LOGGER, this::handleClientAttestationOutcome);
    private final FabricSpectateController playerViews = new FabricSpectateController(
            dataDirectory.resolve("player-view-recovery.state"), this::hasPlayerViewPrivilege, LOGGER);
    private final AppControlBridge entityControl = new AppControlBridge(
            FabricLoader.getInstance().getConfigDir().resolve("servertradeassistant"), LOGGER);

    private volatile ProtectionConfig config;
    private MinecraftServer server;
    private OffenseStore offenses;
    private EventLogger eventLogger;
    private ExecutorService stateWriter;
    private long serverTicks;
    private boolean selectiveMobGriefingLogged;

    @Override
    public void onInitialize() {
        clientAttestation.registerPayload();
        PayloadTypeRegistry.serverboundPlay().register(PlayerViewReadyPayload.TYPE, PlayerViewReadyPayload.CODEC);
        PayloadTypeRegistry.clientboundPlay().register(PlayerViewPayload.TYPE, PlayerViewPayload.CODEC);
        ServerPlayNetworking.registerGlobalReceiver(PlayerViewReadyPayload.TYPE,
                (payload, context) -> playerViews.onReady(context.player(), payload));
        ServerLifecycleEvents.SERVER_STARTING.register(this::onServerStarting);
        ServerLifecycleEvents.SERVER_STARTED.register(this::onServerStarted);
        ServerLifecycleEvents.SERVER_STOPPING.register(this::onServerStopping);
        ServerPlayConnectionEvents.JOIN.register((handler, sender, minecraftServer) -> onJoin(handler.getPlayer()));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, minecraftServer) -> {
            ServerPlayer player = handler.getPlayer();
            playerViews.onDisconnect(player);
            clientAttestation.onDisconnect(player);
            UUID playerId = player.getUUID();
            sessions.remove(playerId);
        });
        ServerLivingEntityEvents.AFTER_DAMAGE.register((entity, source, baseDamageTaken, damageTaken, blocked) -> {
            if (entity instanceof ServerPlayer player
                    && (source.getEntity() != null || source.getDirectEntity() != null)) {
                observeExternalDamage(player);
            }
        });
        ServerTickEvents.END_SERVER_TICK.register(this::onServerTick);
        UseBlockCallback.EVENT.register((player, world, hand, hitResult) -> {
            if (player instanceof ServerPlayer serverPlayer) {
                observeDoorUse(serverPlayer, hitResult.getBlockPos());
            }
            return InteractionResult.PASS;
        });
        PlayerBlockBreakEvents.AFTER.register((world, player, position, state, blockEntity) -> {
            if (player instanceof ServerPlayer serverPlayer) {
                onSuccessfulBreak(serverPlayer, position, state);
            }
        });
        PlayerBlockBreakEvents.BEFORE.register((world, player, position, state, blockEntity) -> {
            if (player instanceof ServerPlayer serverPlayer) {
                observeConcealedOre(serverPlayer, position, state);
            }
            return true;
        });
        ServerMessageEvents.ALLOW_CHAT_MESSAGE.register((chat, player, parameters) -> {
            return allowChatMessage(player, chat.signedContent());
        });
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {
            var privateMessageRoot = dispatcher.getRoot().getChild("msg");
            if (privateMessageRoot != null && dispatcher.getRoot().getChild("whisper") == null) {
                dispatcher.register(Commands.literal("whisper").redirect(privateMessageRoot));
            }
            dispatcher.register(command("serverprotection"));
            dispatcher.register(command("protect"));
            dispatcher.register(antiCheatCommand());
            dispatcher.register(playerInfoCommand());
            dispatcher.register(Commands.literal("ci-spectate")
                    .requires(source -> canUsePlayerViewCommand(source, "ci-spectate"))
                    .then(Commands.argument("player", StringArgumentType.word())
                            .executes(context -> spectate(context.getSource(),
                                    StringArgumentType.getString(context, "player")))));
            dispatcher.register(Commands.literal("unspectate")
                    .requires(source -> canUsePlayerViewCommand(source, "unspectate"))
                    .executes(context -> unspectate(context.getSource())));
            dispatcher.register(Commands.literal("ci-unspectate")
                    .requires(source -> canUsePlayerViewCommand(source, "ci-unspectate"))
                    .executes(context -> unspectate(context.getSource())));
            dispatcher.register(entityAdminCommand());
        });
    }

    private void onServerStarting(MinecraftServer minecraftServer) {
        active = this;
        server = minecraftServer;
        try {
            automaticHarvest = AutomaticHarvestGuard.load(
                    FabricLoader.getInstance().isModLoaded("serverenchantments_fabric"),
                    getClass().getClassLoader(), ServerPlayer.class);
        } catch (ReflectiveOperationException | LinkageError error) {
            automaticHarvest = AutomaticHarvestGuard.absent();
            LOGGER.warn("Could not resolve the optional automatic harvesting guard; player checks remain active", error);
        }
        try {
            teleportArrival = TeleportArrivalGuard.load(
                    FabricLoader.getInstance().isModLoaded("serverteleport_fabric"),
                    getClass().getClassLoader(), ServerPlayer.class);
        } catch (ReflectiveOperationException | RuntimeException | LinkageError error) {
            teleportArrival = TeleportArrivalGuard.absent();
            LOGGER.warn("Could not resolve the optional teleport arrival guard; movement checks remain active", error);
        }
        serverTicks = 0L;
        selectiveMobGriefingLogged = false;
        sessions.clear();
        violations.clear();
        try {
            config = ProtectionConfig.load(configFile);
        } catch (IOException error) {
            LOGGER.error("Server Protection could not load config.yml; protection is disabled: {}", error.getMessage());
            config = disabledConfig();
        }
        reloadAccessPolicy();
        try {
            antiCheatExemptions.load();
        } catch (IOException error) {
            LOGGER.error("Server Protection rejected anti-cheat exemption state; no runtime exemptions were loaded: {}",
                    error.getMessage());
        }
        clientAttestation.load(configFile);
        playerViews.start(minecraftServer);
        entityControl.start(minecraftServer);

        offenses = new OffenseStore(dataDirectory.resolve("offenses.properties"), Clock.SYSTEM);
        try {
            offenses.load();
        } catch (IOException error) {
            LOGGER.error("Server Protection could not load offense state; starting with bounded empty state: {}", error.getMessage());
        }
        eventLogger = new EventLogger(dataDirectory.resolve("events.jsonl"), LOGGER::info);
        stateWriter = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "server-protection-fabric-state");
            thread.setDaemon(true);
            thread.setPriority(Thread.MIN_PRIORITY);
            return thread;
        });
        LOGGER.info("Server Protection Fabric started with {} bounded checks.", SUPPORTED_CHECKS.length);
    }

    private void onServerStarted(MinecraftServer minecraftServer) {
        if (minecraftServer == server) {
            ensureSelectiveMobGriefing(minecraftServer);
            reportPacketAntiXrayRuntime();
        }
    }

    private void ensureSelectiveMobGriefing(MinecraftServer minecraftServer) {
        var gameRules = minecraftServer.getGameRules();
        Boolean currentValue = gameRules.get(GameRules.MOB_GRIEFING);
        if (!SelectiveMobGriefing.shouldRestoreGlobalRule(currentValue)) return;
        gameRules.set(GameRules.MOB_GRIEFING, true, minecraftServer);
        if (!selectiveMobGriefingLogged) {
            selectiveMobGriefingLogged = true;
            LOGGER.info("Selective mob griefing enabled: villager, piglin, and item-pickup behaviour remains vanilla; Enderman block movement and Creeper block damage are disabled.");
        }
    }

    private boolean reportPacketAntiXrayRuntime() {
        boolean providerLoaded = FabricLoader.getInstance().isModLoaded("meowantixray");
        boolean providerActive = false;
        if (providerLoaded) {
            try {
                providerActive = MeowAntiXrayMod.fakeOre().isEnabled();
            } catch (RuntimeException | LinkageError error) {
                LOGGER.error("Server Protection Fabric could not inspect the packet Anti-Xray provider: {}", error.getMessage());
            }
        }
        if (providerActive) {
            LOGGER.info("Server Protection Fabric packet Anti-Xray provider loaded; concealed-ore detection remains available as a secondary signal.");
            return true;
        }
        if (config != null && config.hiddenOreDetection().enabled()) {
            LOGGER.error(providerLoaded
                    ? "Server Protection Fabric packet Anti-Xray provider is inactive; ore packets are not being obfuscated."
                    : "Server Protection Fabric packet Anti-Xray provider is missing; ore packets are not being obfuscated.");
        } else if (providerLoaded) {
            LOGGER.info("Server Protection Fabric packet Anti-Xray provider loaded but ore obfuscation is disabled.");
        } else {
            LOGGER.warn("Server Protection Fabric packet Anti-Xray provider is missing and ore protection is disabled.");
        }
        return false;
    }

    private void onServerStopping(MinecraftServer minecraftServer) {
        if (active == this) active = null;
        clientAttestation.clear();
        playerViews.shutdown(minecraftServer);
        entityControl.stop();
        ExecutorService writer = stateWriter;
        if (writer != null) {
            queueStateSave();
            writer.shutdown();
            try {
                if (!writer.awaitTermination(2, TimeUnit.SECONDS)) writer.shutdownNow();
            } catch (InterruptedException interrupted) {
                writer.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
        if (offenses != null) {
            try {
                offenses.saveIfDirty();
            } catch (IOException error) {
                LOGGER.warn("Could not finish saving Server Protection state: {}", error.getMessage());
            }
        }
        if (eventLogger != null) eventLogger.close();
        sessions.clear();
        violations.clear();
        stateWriter = null;
        eventLogger = null;
        offenses = null;
        server = null;
    }

    private void onJoin(ServerPlayer player) {
        playerViews.onJoin(player);
        long now = System.currentTimeMillis();
        ProtectionConfig current = config;
        long graceMillis = secondsToMillis(current == null ? 5.0 : current.grace().joinSeconds());
        sessions.put(player.getUUID(), new PlayerSession(now, now + graceMillis, player.level()));
        trimSessions();
        if (offenses != null && !antiCheatExemptions.contains(player.getUUID())) {
            OffenseRecord record = offenses.get(player.getUUID());
            if (record != null && record.permanentBan()) {
                player.connection.disconnect(message(current.messages().loginPermanentBan(), Map.of(
                        "player", player.getGameProfile().name())));
                return;
            } else if (record != null && record.temporaryBanUntil() > now) {
                long remainingMinutes = Math.max(1L, (record.temporaryBanUntil() - now + 59_999L) / 60_000L);
                player.connection.disconnect(message(current.messages().loginTemporaryBan(), Map.of(
                        "player", player.getGameProfile().name(),
                        "remaining_minutes", remainingMinutes)));
                return;
            }
        }
        clientAttestation.onJoin(player, now);
    }

    private void observeDoorUse(ServerPlayer player, BlockPos position) {
        ProtectionConfig current = config;
        if (!ready(current) || !current.checks().phase() || position == null
                || isProtectionExempt(player)) return;
        BlockState state = player.level().getBlockState(position);
        if (!(state.getBlock() instanceof DoorBlock door) || !door.type().canOpenByHand()) return;
        long now = System.currentTimeMillis();
        session(player, now, current).doorTransition.observe(now, player.level(),
                position.getX(), canonicalDoorLowerY(state.getValue(DoorBlock.HALF), position.getY()),
                position.getZ(), state.getValue(DoorBlock.OPEN));
    }

    /**
     * Entity and projectile damage is authoritative server evidence that the following movement
     * can be knockback rather than player input. Clear accumulated movement evidence immediately
     * so a pre-hit sample cannot combine with post-hit displacement into a warning.
     */
    private void observeExternalDamage(ServerPlayer player) {
        ProtectionConfig current = config;
        if (!ready(current) || player == null || isProtectionExempt(player)) return;
        long now = System.currentTimeMillis();
        PlayerSession session = session(player, now, current);
        session.velocityGraceUntil = Math.max(session.velocityGraceUntil,
                now + secondsToMillis(current.grace().velocitySeconds()));
        session.movement.reset();
        session.behavior.resetMovement();
    }

    private void onServerTick(MinecraftServer minecraftServer) {
        // The manager may apply saved gamerules after SERVER_STARTED. Repair a
        // stale mob_griefing=false value before the next simulation tick.
        ensureSelectiveMobGriefing(minecraftServer);
        double tps = tickRate.tick(System.nanoTime());
        // Camera/recovery sessions are lifecycle infrastructure, not an anti-cheat check. They must
        // keep working even when config loading fails or protection is intentionally disabled.
        playerViews.tick(minecraftServer);
        entityControl.tick(minecraftServer);
        long now = System.currentTimeMillis();
        ProtectionConfig current = config;
        if (current == null || offenses == null || eventLogger == null) return;
        serverTicks++;
        if (serverTicks % 20L == 0L) clientAttestation.tick(now);

        for (ServerPlayer player : minecraftServer.getPlayerList().getPlayers()) {
            PlayerSession session = session(player, now, current);
            if (!current.enabled()) {
                session.movement.reset();
                continue;
            }
            if (isProtectionExempt(player)) {
                // A per-player exemption must also avoid the expensive collision and movement
                // analysis work, not merely suppress its eventual warning or punishment.
                session.resetEvidence();
                continue;
            }
            if (session.level != player.level()) {
                session.level = player.level();
                session.movement.reset();
                session.doorTransition.reset();
                session.boatSupport.reset();
                session.graceUntil = now + secondsToMillis(current.grace().teleportSeconds());
            }
            // The teleport mod intentionally holds movement until landing terrain is delivered.
            // Clear only movement evidence while that exact bounded runtime hold exists.
            if (teleportArrival.resetMovementIfAwaiting(player, session.movement, session.behavior)) continue;
            if (player.hurtTime > 0) {
                // Fallback for modded damage paths that do not reach Fabric's AFTER_DAMAGE hook.
                session.velocityGraceUntil = Math.max(session.velocityGraceUntil,
                        now + secondsToMillis(current.grace().velocitySeconds()));
            }

            Vec3 position = player.position();
            var supportingBoat = BoatSupportProbe.find(player);
            boolean groundSupported = hasGroundSupport(player, supportingBoat);
            boolean boatDepartureGrace = session.boatSupport.observe(serverTicks,
                    player.getBoundingBox(), supportingBoat != null);
            if (player.isPassenger() || player.isVehicle()) {
                session.vehicleGraceUntil = now + 2_500L;
            }
            boolean movementTransition = session.movementTransitions.exempt(
                    now, player.isFallFlying(), player.isAutoSpinAttack());
            boolean broadExempt = player.isCreative()
                    || player.isSpectator() || player.isPassenger() || player.isVehicle()
                    || now < session.vehicleGraceUntil
                    || player.getAbilities().mayfly || movementTransition
                    || !player.level().hasChunkAt(player.blockPosition());
            boolean forcedMovement = now < session.velocityGraceUntil;
            boolean fluidMovement = isFluidMovement(player);
            boolean environmentalMovement = fluidMovement || isSpecialMovementSurface(player);
            boolean flightExempt = broadExempt || player.isFallFlying() || player.isSwimming()
                    || player.onClimbable() || fluidMovement
                    || player.isInPowderSnow || player.wasInPowderSnow
                    || player.hasEffect(MobEffects.LEVITATION) || player.hasEffect(MobEffects.SLOW_FALLING)
                    || forcedMovement || boatDepartureGrace;
            AABB collisionProbe = player.getBoundingBox().deflate(0.04);
            boolean collisionFree = !current.checks().phase()
                    || BoatSupportProbe.collisionFree(player, collisionProbe, supportingBoat);
            boolean doorTransition = !collisionFree
                    && collisionIsOnlyChangedDoor(player, session.doorTransition, now, collisionProbe);
            double movementScale = player.getAttributeValue(Attributes.MOVEMENT_SPEED) / 0.10;
            MovementAnalyzer.Result result = session.movement.evaluate(new MovementAnalyzer.Sample(
                    position.x, position.y, position.z, groundSupported, broadExempt, flightExempt,
                    forcedMovement, environmentalMovement,
                    now < session.graceUntil, collisionFree, doorTransition, movementScale, tps, 1), current);

            boolean patternExempt = broadExempt || now < session.graceUntil
                    || tps + 1.0e-6 < current.minimumTps()
                    || player.isFallFlying() || player.isSwimming() || player.onClimbable()
                    || forcedMovement || environmentalMovement || boatDepartureGrace
                    || player.isInPowderSnow || player.wasInPowderSnow
                    || player.hasEffect(MobEffects.JUMP_BOOST)
                    || player.hasEffect(MobEffects.LEVITATION)
                    || player.hasEffect(MobEffects.SLOW_FALLING);
            var useEffects = player.getUseItem().getOrDefault(
                    net.minecraft.core.component.DataComponents.USE_EFFECTS,
                    net.minecraft.world.item.component.UseEffects.DEFAULT);
            int behaviorFlags = session.behavior.observeMovement(now,
                    result.verticalPerTick(), result.horizontalPerTick(), player.onGround(), groundSupported,
                    isOnLiquidSurface(player), player.isInWater() || player.isInLava(),
                    ItemSlowPolicy.check(player.isUsingItem(), useEffects.canSprint(), useEffects.speedMultiplier()), patternExempt,
                    Math.max(0.6, player.getAttributeValue(Attributes.STEP_HEIGHT)),
                    current.movement().maxUseItemBlocksPerTick() * Math.max(1.0, movementScale),
                    current.movement().groundSpoofSamples(), current.movement().waterWalkSamples(),
                    current.movement().stepSamples(), current.movement().noSlowSamples());

            if (current.checks().invalidPosition() && result.has(MovementAnalyzer.INVALID_POSITION)
                    && !isCheckExempt(player, Check.INVALID_POSITION)) {
                report(player, session, Check.INVALID_POSITION, 16.0, "Invalid position",
                        Map.of(), now);
            }
            if (current.checks().invalidRotation() && invalidRotation(player)
                    && !isCheckExempt(player, Check.INVALID_ROTATION)) {
                report(player, session, Check.INVALID_ROTATION, 12.0, "Impossible view rotation",
                        Map.of("yaw", decimal(player.getYRot()), "pitch", decimal(player.getXRot())), now);
            }
            if (result.has(MovementAnalyzer.HORIZONTAL_SPEED) && !isCheckExempt(player, Check.SPEED)) {
                double excess = result.horizontalPerTick() - result.allowedHorizontal();
                report(player, session, Check.SPEED, 1.0 + Math.min(7.0, excess * 10.0),
                        "Horizontal movement exceeded the safe limit",
                        Map.of("observed", decimal(result.horizontalPerTick()),
                                "allowed", decimal(result.allowedHorizontal())), now);
            }
            if (result.has(MovementAnalyzer.VERTICAL_FLIGHT) && !isCheckExempt(player, Check.FLIGHT)) {
                report(player, session, Check.FLIGHT, 1.5, "Sustained unsupported movement",
                        Map.of("airTicks", result.airTicks()), now);
            }
            if (result.has(MovementAnalyzer.PHASE) && !isCheckExempt(player, Check.PHASE)) {
                report(player, session, Check.PHASE, 3.0, "Movement through a solid collision",
                        Map.of("samples", result.phaseSamples()), now);
            }
            if (current.checks().groundSpoof()
                    && (behaviorFlags & BehaviorPatternAnalyzer.GROUND_SPOOF) != 0
                    && !isCheckExempt(player, Check.GROUND_SPOOF)) {
                report(player, session, Check.GROUND_SPOOF, 2.0,
                        "Repeated client ground claims had no server-side support",
                        Map.of("samples", current.movement().groundSpoofSamples()), now);
            }
            if (current.checks().waterWalk()
                    && (behaviorFlags & BehaviorPatternAnalyzer.WATER_WALK) != 0
                    && !isCheckExempt(player, Check.WATER_WALK)) {
                report(player, session, Check.WATER_WALK, 2.0,
                        "Sustained unsupported movement across a liquid surface",
                        Map.of("samples", current.movement().waterWalkSamples()), now);
            }
            if (current.checks().step()
                    && (behaviorFlags & BehaviorPatternAnalyzer.STEP) != 0
                    && !isCheckExempt(player, Check.STEP)) {
                report(player, session, Check.STEP, 2.2,
                        "Repeatedly climbed higher than the server step-height attribute",
                        Map.of("samples", current.movement().stepSamples()), now);
            }
            if (current.checks().noSlow()
                    && (behaviorFlags & BehaviorPatternAnalyzer.NO_SLOW) != 0
                    && !isCheckExempt(player, Check.NO_SLOW)) {
                report(player, session, Check.NO_SLOW, 1.8,
                        "Repeated full-speed movement while using a slowing item",
                        Map.of("samples", current.movement().noSlowSamples()), now);
            }
        }

        if (serverTicks % 100L == 0L) queueStateSave();
        if (serverTicks % 1_200L == 0L) {
            violations.prune(SESSION_IDLE_MILLIS);
            pruneSessions(now);
            offenses.pruneInactive(OffenseStore.DEFAULT_RETENTION_MILLIS);
        }
    }

    private InteractionResult onAttack(ServerPlayer player, Entity target) {
        if (!(target instanceof LivingEntity)) {
            return InteractionResult.PASS;
        }
        ProtectionConfig current = config;
        if (current == null || !current.enabled() || offenses == null || eventLogger == null) {
            return InteractionResult.PASS;
        }
        long now = System.currentTimeMillis();
        PlayerSession session = session(player, now, current);
        if (isProtectionExempt(player) || player.isCreative() || player.isSpectator()
                || now < session.graceUntil) {
            return InteractionResult.PASS;
        }
        Vec3 eye = player.getEyePosition();
        Vec3 velocity = target.getDeltaMovement();
        Vec3 viewDirection = player.getLookAngle();
        AABB box = target.getBoundingBox();
        boolean teleportCapable = BuiltInRegistries.ENTITY_TYPE.getKey(target.getType()).toString()
                .equals("minecraft:enderman");
        int pingMillis = Math.max(0, player.connection.latency());
        ReachCheckMath.Point eyePoint = point(eye);
        ReachCheckMath.Box currentBox = reachBox(box);
        AABB beforeTeleportBounds = null;
        CombatTargetStability.Selection targetGeometry =
                new CombatTargetStability.Selection(currentBox, false, false);
        if (teleportCapable && target instanceof EntityTeleportHistory history) {
            beforeTeleportBounds = history.serverProtection$beforeTeleportBounds();
            if (beforeTeleportBounds != null) {
                targetGeometry = CombatTargetStability.reconcile(
                        eyePoint, currentBox, reachBox(beforeTeleportBounds),
                        history.serverProtection$teleportedAtMillis(), now, pingMillis);
            }
        }
        boolean currentLineOfSight = hasCombatLineOfSight(player, target, eye, box);
        boolean previousLineOfSight = targetGeometry.recentTeleport() && beforeTeleportBounds != null
                && hasCombatLineOfSightToBox(player, eye, beforeTeleportBounds);
        boolean reconciledLineOfSight = reconciledCombatLineOfSight(
                currentLineOfSight, previousLineOfSight, targetGeometry.recentTeleport());
        CombatAnalyzer.Result result = session.combat.evaluate(new CombatAnalyzer.Attack(
                target.getUUID(), now, pingMillis, tickRate.tps(),
                Math.max(0.0, player.getAttributeValue(Attributes.ENTITY_INTERACTION_RANGE)),
                reconciledLineOfSight,
                eyePoint, targetGeometry.box(), point(velocity), point(viewDirection),
                targetGeometry.recentTeleport()), current);

        if (current.checks().criticals() && !isCheckExempt(player, Check.CRITICALS)) {
            boolean impossibleCritical = !player.onGround() && player.fallDistance > 0.0f
                    && player.fallDistance <= 0.085f && hasGroundSupport(player)
                    && !player.isInWater() && !player.isInLava() && !player.onClimbable()
                    && !player.hasEffect(MobEffects.LEVITATION)
                    && !player.hasEffect(MobEffects.SLOW_FALLING);
            int behaviorFlags = session.behavior.observeCritical(now, impossibleCritical,
                    current.combat().criticalSamples(), current.combat().criticalWindowMillis());
            if ((behaviorFlags & BehaviorPatternAnalyzer.CRITICALS) != 0) {
                report(player, session, Check.CRITICALS, 2.4,
                        "Repeated critical attacks used an unsupported micro-fall state",
                        Map.of("fallDistance", decimal(player.fallDistance),
                                "samples", current.combat().criticalSamples()), now);
            }
        }

        boolean reachDetected = result.has(CombatAnalyzer.REACH) && !isCheckExempt(player, Check.REACH);
        boolean wallHitDetected = result.has(CombatAnalyzer.WALL_HIT) && !isCheckExempt(player, Check.WALL_HIT);
        if (reachDetected) {
            report(player, session, Check.REACH, 2.0 + Math.min(8.0, result.reachExcess() * 8.0),
                    "Attack reach exceeded the reconciled limit",
                    Map.of("observed", decimal(result.observedReach()),
                            "allowed", decimal(result.allowedReach()),
                            "ping", player.connection.latency()), now);
        }
        if (wallHitDetected) {
            report(player, session, Check.WALL_HIT, 3.0, "Repeated attack through an occluding block",
                    Map.of("observed", decimal(result.observedReach())), now);
        }
        if (result.has(CombatAnalyzer.AUTO_CLICKER) && !isCheckExempt(player, Check.AUTO_CLICKER)) {
            report(player, session, Check.AUTO_CLICKER,
                    1.0 + Math.min(5.0, (result.cps() - current.combat().maxCps()) * 0.25),
                    "Attack rate exceeded the configured CPS limit", Map.of("cps", result.cps()), now);
        }
        if (result.has(CombatAnalyzer.MULTI_TARGET) && !isCheckExempt(player, Check.MULTI_TARGET)) {
            report(player, session, Check.MULTI_TARGET, 3.0, "Too many distinct targets in one combat window",
                    Map.of("targets", result.distinctTargets(),
                            "windowMillis", current.combat().multiTargetWindowMillis()), now);
        }
        if (result.has(CombatAnalyzer.AIM_DIRECTION) && !isCheckExempt(player, Check.AIM_DIRECTION)) {
            report(player, session, Check.AIM_DIRECTION, 2.2,
                    "Repeated attacks while view direction missed the target hitbox",
                    Map.of("deviationDegrees", decimal(result.aimDeviationDegrees())), now);
        }
        if (result.has(CombatAnalyzer.RAPID_SWITCH) && !isCheckExempt(player, Check.KILL_AURA)) {
            report(player, session, Check.KILL_AURA, 3.0,
                    "Repeated implausibly fast wide-angle target switches",
                    Map.of("switchAngleDegrees", decimal(result.switchAngleDegrees()),
                            "windowMillis", current.combat().rapidSwitchMillis()), now);
        }
        if (result.has(CombatAnalyzer.CLICK_PATTERN) && !isCheckExempt(player, Check.CLICK_PATTERN)) {
            report(player, session, Check.CLICK_PATTERN, 1.8,
                    "Attack timing remained unnaturally identical across a long sample",
                    Map.of("samples", current.combat().clickPatternSamples(),
                            "deviationMillis", decimal(result.clickIntervalDeviationMillis())), now);
        }

        // Stop only confirmed spatially impossible attacks; rate heuristics remain score-only.
        return shouldCancelSpatialAttack(current.responseEnabled(),
                reachDetected, wallHitDetected)
                ? InteractionResult.FAIL : InteractionResult.PASS;
    }

    /**
     * Vanilla's entity line-of-sight test aims at one central point. A legitimate attack through
     * a one-block or feet-level opening can therefore report false even though part of the target
     * is plainly exposed. Wall-hit evidence is allowed only when every inset sample on the target
     * body is occluded.
     */
    private static boolean hasCombatLineOfSight(ServerPlayer player, Entity target, Vec3 eye, AABB box) {
        if (player.hasLineOfSight(target)) return true;
        return hasCombatLineOfSightToBox(player, eye, box);
    }

    private static boolean hasCombatLineOfSightToBox(ServerPlayer player, Vec3 eye, AABB box) {
        double insetX = Math.min(0.12, Math.max(0.02, (box.maxX - box.minX) * 0.15));
        double insetZ = Math.min(0.12, Math.max(0.02, (box.maxZ - box.minZ) * 0.15));
        double low = box.minY + Math.min(0.18, Math.max(0.04, (box.maxY - box.minY) * 0.08));
        double middle = (box.minY + box.maxY) * 0.5;
        double high = box.maxY - Math.min(0.18, Math.max(0.04, (box.maxY - box.minY) * 0.08));
        double[] xs = { box.minX + insetX, (box.minX + box.maxX) * 0.5, box.maxX - insetX };
        double[] zs = { box.minZ + insetZ, (box.minZ + box.maxZ) * 0.5, box.maxZ - insetZ };
        double[] ys = { low, middle, high };
        for (double y : ys) {
            for (int index = 0; index < xs.length; index++) {
                Vec3 sample = new Vec3(xs[index], y, zs[index]);
                HitResult hit = player.level().clip(new ClipContext(
                        eye, sample, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, player));
                if (hit.getType() == HitResult.Type.MISS || hit.getLocation().distanceToSqr(eye) + 0.01 >= sample.distanceToSqr(eye)) {
                    return true;
                }
            }
        }
        return false;
    }

    static boolean reconciledCombatLineOfSight(boolean currentVisible,
                                                boolean previousVisible,
                                                boolean recentTeleport) {
        return currentVisible || (recentTeleport && previousVisible);
    }

    /** Called by the shared BlockItem mixin after vanilla accepted an actual placement. */
    public static void observeSuccessfulPlacement(Player player, BlockPos position) {
        ServerProtectionFabric instance = active;
        if (instance != null && player instanceof ServerPlayer serverPlayer) {
            instance.onSuccessfulPlace(serverPlayer, position);
        }
    }

    /** Called before vanilla handles one player inventory-click packet. */
    public static boolean allowInventoryClick(ServerPlayer player, boolean helperCompatible) {
        ServerProtectionFabric instance = active;
        return instance == null || instance.allowInventoryAction(player, helperCompatible);
    }

    /**
     * Observes raw attack attempts before vanilla's range rejection. This is the sole Fabric combat
     * entry point, so accepted packets are never double-counted by an event callback.
     */
    public static boolean allowAttackPacket(ServerPlayer player, int entityId) {
        ServerProtectionFabric instance = active;
        if (instance == null || player == null || entityId < 0) return true;
        try {
            Entity target = player.level().getEntity(entityId);
            if (target == null || target == player) return true;
            return instance.onAttack(player, target) != InteractionResult.FAIL;
        } catch (RuntimeException unavailable) {
            PlayerSession session = instance.sessions.get(player.getUUID());
            if (session != null) session.combat.reset();
            instance.logPacketHookFailure("attack", unavailable);
            return true;
        }
    }

    /** Observes raw block interactions that vanilla may reject before successful block callbacks. */
    public static boolean allowBlockInteractionPacket(ServerPlayer player, BlockPos position, boolean placement) {
        ServerProtectionFabric instance = active;
        if (instance == null || player == null || position == null) return true;
        try {
            ProtectionConfig current = instance.config;
            Check check = placement ? Check.PLACE_REACH : Check.BREAK_REACH;
            boolean enabled = placement ? current != null && current.checks().placeReach()
                    : current != null && current.checks().breakReach();
            if (!instance.ready(current) || !enabled || instance.isCheckExempt(player, check)) return true;
            long now = System.currentTimeMillis();
            PlayerSession session = instance.session(player, now, current);
            if (instance.worldActivityExempt(player, session, now)) return true;
            Vec3 eye = player.getEyePosition();
            double x = Math.max(position.getX(), Math.min(position.getX() + 1.0, eye.x));
            double y = Math.max(position.getY(), Math.min(position.getY() + 1.0, eye.y));
            double z = Math.max(position.getZ(), Math.min(position.getZ() + 1.0, eye.z));
            double observed = eye.distanceTo(new Vec3(x, y, z));
            double base = Math.max(1.0, player.getAttributeValue(Attributes.BLOCK_INTERACTION_RANGE));
            double allowed = base + current.world().blockReachAllowance()
                    + Math.min(0.35, Math.max(0, player.connection.latency()) * 0.001);
            if (!Double.isFinite(observed) || observed <= allowed) {
                session.resetRawBlockReach(placement);
                return true;
            }
            if (!session.confirmRawBlockReach(placement, now)) return true;
            instance.report(player, session, check, 3.0 + Math.min(5.0, observed - allowed),
                    (placement ? "Attempted to place" : "Attempted to break")
                            + " a block beyond the server interaction range",
                    Map.of("observed", decimal(observed), "allowed", decimal(allowed),
                            "x", position.getX(), "y", position.getY(), "z", position.getZ()), now);
            return !current.responseEnabled();
        } catch (RuntimeException unavailable) {
            PlayerSession session = instance.sessions.get(player.getUUID());
            if (session != null) session.resetRawBlockReach(placement);
            instance.logPacketHookFailure(placement ? "place" : "break", unavailable);
            return true;
        }
    }

    private void logPacketHookFailure(String kind, RuntimeException error) {
        long now = System.currentTimeMillis();
        long previous = lastPacketFailureLogAt.get();
        if (now >= previous && now - previous >= PACKET_FAILURE_LOG_INTERVAL_MILLIS
                && lastPacketFailureLogAt.compareAndSet(previous, now)) {
            LOGGER.warn("Server Protection {} packet check failed open: {}", kind, error.toString());
        }
    }

    /** Records movement packet cadence; this is score-only and never cancels a packet. */
    public static void observeMovementPacket(ServerPlayer player) {
        observeMovementPacket(player, false);
    }

    /** A vanilla correction response is an extra packet, not an extra client simulation tick. */
    public static void observeMovementPacket(ServerPlayer player, boolean confirmedCorrectionResponse) {
        ServerProtectionFabric instance = active;
        if (instance == null || player == null) return;
        try {
            ProtectionConfig current = instance.config;
            if (!instance.ready(current) || instance.isProtectionExempt(player)) return;
            long now = System.currentTimeMillis();
            PlayerSession session = instance.session(player, now, current);
            // Packet silence while a client loads terrain or stalls is not hovering. Track this
            // independently of the optional timer check so its setting cannot affect flight safety.
            session.movementTransitions.observePacket(now);
            if (instance.teleportArrival.resetMovementIfAwaiting(player, session.movement, session.behavior)) return;
            // Skip exactly one verified response; do not clear existing timer evidence or grant
            // ongoing grace. Ordinary packets still count during repeated server corrections.
            if (confirmedCorrectionResponse) return;
            if (!current.checks().timer()) return;
            boolean exempt = player.isCreative()
                    || player.isSpectator() || player.isPassenger() || player.isVehicle()
                    || now < session.vehicleGraceUntil || player.getAbilities().mayfly
                    || session.movementTransitions.packetTimingUncertain(now)
                    || session.boatSupport.timerGrace(instance.serverTicks)
                    || now < session.graceUntil || instance.tickRate.tps() < current.minimumTps()
                    || instance.isCheckExempt(player, Check.TIMER);
            int flags = session.behavior.observeMovementPacket(now,
                    current.movement().maxPacketsPerSecond(), current.movement().timerEvidenceWindows(), exempt);
            if ((flags & BehaviorPatternAnalyzer.TIMER) != 0) {
                instance.report(player, session, Check.TIMER, 2.0,
                        "Sustained movement packet rate exceeded the normal client clock",
                        Map.of("limit", current.movement().maxPacketsPerSecond(),
                                "windows", current.movement().timerEvidenceWindows()), now);
            }
        } catch (RuntimeException unavailable) {
            PlayerSession session = instance.sessions.get(player.getUUID());
            if (session != null) session.behavior.reset();
            instance.logPacketHookFailure("movement", unavailable);
        }
    }

    private void onSuccessfulBreak(ServerPlayer player, BlockPos position, BlockState brokenState) {
        // These extra blocks were authorized by the server enchantment queue, not player
        // mining packets. Vanilla/Fabric permissions still execute in destroyBlock itself.
        if (automaticHarvest.isAutomaticBreak(player)) return;
        ProtectionConfig current = config;
        if (!ready(current)) return;
        long now = System.currentTimeMillis();
        PlayerSession session = session(player, now, current);
        if (worldActivityExempt(player, session, now)) return;
        String blockId = BuiltInRegistries.BLOCK.getKey(brokenState.getBlock()).toString();
        boolean sweepHarvest = BreakRatePolicy.isSweepHarvestBlock(blockId);
        float destroyProgress = brokenState.getDestroyProgress(player, player.level(), position);
        boolean instantMining = BreakRatePolicy.allowsFastMining(sweepHarvest, destroyProgress);
        boolean stableTiming = tickRate.tps() >= current.minimumTps();
        if (!stableTiming) {
            session.activity.resetBreakActivity();
            session.behavior.resetBreakEvidence();
        }
        if (stableTiming && current.checks().fastBreak() && !isCheckExempt(player, Check.FAST_BREAK)) {
            int breakLimit = BreakRatePolicy.breaksPerSecondLimit(
                    instantMining, current.world().maxBreaksPerSecond());
            ActivityAnalyzer.Assessment result = session.activity.breakBlock(
                    now, breakLimit, instantMining);
            if (result.violation()) {
                report(player, session, Check.FAST_BREAK,
                        0.8 + Math.min(5.0, (result.count() - result.limit()) * 0.2),
                        "Broke " + result.count()
                                + (sweepHarvest ? " sweep-harvest blocks" : " blocks")
                                + " in one second",
                        Map.of("block", blockId, "count", result.count(),
                                "limit", result.limit(), "sweepHarvest", sweepHarvest), now);
            }
        }
        // Vanilla instant mining includes ordinary blocks with the correct tool, Efficiency and
        // Haste. Five accepted blocks across a row in 250 ms is legal in that state.
        if (instantMining) session.behavior.resetBreakEvidence();
        if (stableTiming && !instantMining && current.checks().multiBreak()
                && !isCheckExempt(player, Check.MULTI_BREAK)) {
            int flags = session.behavior.observeBreak(now,
                    position.getX() + 0.5, position.getY() + 0.5, position.getZ() + 0.5,
                    current.world().multiBreakSamples(), current.world().multiBreakWindowMillis(),
                    current.world().multiBreakMinSpan());
            if ((flags & BehaviorPatternAnalyzer.MULTI_BREAK) != 0) {
                report(player, session, Check.MULTI_BREAK, 3.0,
                        "Broke an implausibly wide cluster of blocks in one short window",
                        Map.of("samples", current.world().multiBreakSamples(),
                                "windowMillis", current.world().multiBreakWindowMillis(),
                                "block", blockId, "destroyProgress", decimal(destroyProgress)), now);
            }
        }
        if (current.checks().breakReach() && !isCheckExempt(player, Check.BREAK_REACH)) {
            reportBlockReach(player, session, position, Check.BREAK_REACH, "Broke", now, current);
        }
    }

    private void observeConcealedOre(ServerPlayer player, BlockPos position,
                                     net.minecraft.world.level.block.state.BlockState state) {
        if (automaticHarvest.isAutomaticBreak(player)) return;
        ProtectionConfig current = config;
        if (!ready(current) || !current.hiddenOreDetection().enabled()) return;
        long now = System.currentTimeMillis();
        PlayerSession session = session(player, now, current);
        if (worldActivityExempt(player, session, now) || hasPlayerViewPrivilege(player)
                || tickRate.tps() < current.minimumTps()) {
            session.hiddenOre.reset();
            return;
        }
        String blockId = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
        boolean valuable = VALUABLE_ORES.contains(blockId);
        boolean exposed = valuable && hasAdjacentAirOrFluid(player.level(), position);
        HiddenOreAnalyzer.Assessment assessment = session.hiddenOre.observe(
                now, valuable, exposed, current.hiddenOreDetection().requiredSamples(),
                current.hiddenOreDetection().windowMillis());
        if (!assessment.violation()) return;
        report(player, session, Check.HIDDEN_ORE, 8.0,
                "Repeatedly mined completely concealed ore",
                Map.of("ore", blockId,
                        "samples", assessment.samples(),
                        "x", position.getX(), "y", position.getY(), "z", position.getZ()), now);
    }

    private static boolean hasAdjacentAirOrFluid(ServerLevel level, BlockPos position) {
        for (Direction direction : Direction.values()) {
            net.minecraft.world.level.block.state.BlockState adjacent = level.getBlockState(position.relative(direction));
            if (adjacent.isAir() || !adjacent.getFluidState().isEmpty()) return true;
        }
        return false;
    }

    private void onSuccessfulPlace(ServerPlayer player, BlockPos position) {
        ProtectionConfig current = config;
        if (!ready(current)) return;
        long now = System.currentTimeMillis();
        PlayerSession session = session(player, now, current);
        if (worldActivityExempt(player, session, now)) return;
        if (current.checks().fastPlace() && !isCheckExempt(player, Check.FAST_PLACE)) {
            ActivityAnalyzer.Assessment result = session.activity.placeBlock(
                    now, current.world().maxPlacesPerSecond());
            if (result.violation()) {
                report(player, session, Check.FAST_PLACE,
                        0.9 + Math.min(5.0, (result.count() - result.limit()) * 0.2),
                        "Placed " + result.count() + " blocks in one second",
                        Map.of("count", result.count(), "limit", result.limit()), now);
            }
        }
        if (current.checks().scaffold() && !isCheckExempt(player, Check.SCAFFOLD)) {
            double deviation = blockAimDeviation(player, position);
            boolean beneath = position.getY() + 1.01 <= player.position().y;
            int flags = session.behavior.observeScaffold(now,
                    beneath && deviation > current.world().scaffoldAimDegrees(),
                    current.world().scaffoldSamples(), current.world().scaffoldWindowMillis());
            if ((flags & BehaviorPatternAnalyzer.SCAFFOLD) != 0) {
                report(player, session, Check.SCAFFOLD, 2.2,
                        "Repeated beneath-player placements were far outside the server-visible aim direction",
                        Map.of("deviationDegrees", decimal(deviation),
                                "samples", current.world().scaffoldSamples()), now);
            }
        }
        if (current.checks().placeReach() && !isCheckExempt(player, Check.PLACE_REACH)) {
            reportBlockReach(player, session, position, Check.PLACE_REACH, "Placed", now, current);
        }
    }

    private void reportBlockReach(ServerPlayer player, PlayerSession session, BlockPos position,
                                  Check check, String verb, long now, ProtectionConfig current) {
        if (position == null) return;
        Vec3 eye = player.getEyePosition();
        double x = Math.max(position.getX(), Math.min(position.getX() + 1.0, eye.x));
        double y = Math.max(position.getY(), Math.min(position.getY() + 1.0, eye.y));
        double z = Math.max(position.getZ(), Math.min(position.getZ() + 1.0, eye.z));
        double observed = eye.distanceTo(new Vec3(x, y, z));
        double base = Math.max(1.0, player.getAttributeValue(Attributes.BLOCK_INTERACTION_RANGE));
        double allowed = base + current.world().blockReachAllowance()
                + Math.min(0.35, Math.max(0, player.connection.latency()) * 0.001);
        if (!Double.isFinite(observed) || observed <= allowed) return;
        report(player, session, check, 2.5 + Math.min(5.0, observed - allowed),
                verb + " a block beyond the server interaction range",
                Map.of("observed", decimal(observed), "allowed", decimal(allowed),
                        "x", position.getX(), "y", position.getY(), "z", position.getZ()), now);
    }

    private boolean allowChatMessage(ServerPlayer player, String message) {
        ProtectionConfig current = config;
        if (!ready(current) || !current.checks().chatSpam()
                || isCheckExempt(player, Check.CHAT_SPAM)) return true;
        long now = System.currentTimeMillis();
        PlayerSession session = session(player, now, current);
        if (abuseActivityExempt(player, session, now)) return true;
        ActivityAnalyzer.Assessment result = session.activity.chat(
                now, message, current.abuse().maxChatPerFiveSeconds());
        if (!result.violation()) return true;
        String reason = result.repeated()
                ? "Repeated the same chat message"
                : "Sent " + result.count() + " messages in five seconds";
        report(player, session, Check.CHAT_SPAM, result.repeated() ? 1.5 : 1.0, reason,
                Map.of("count", result.count(), "limit", result.limit(), "repeated", result.repeated()), now);
        return !current.responseEnabled();
    }

    /**
     * Intercepts a network command before vanilla parses it.
     *
     * @return true when the packet was handled (viewed, denied, rate-limited, or dispatched once)
     * and vanilla must be cancelled; false when vanilla should process it normally.
     */
    public static boolean handleCommand(ServerPlayer player, String commandLine) {
        ServerProtectionFabric instance = active;
        if (instance == null || player == null) return false;
        if (instance.handleActiveViewCommand(player, commandLine)) return true;
        if (instance.handlePlayerViewCommandInternal(player, commandLine)) return true;
        if (instance.handlePlayerInfoCommandInternal(player, commandLine)) return true;
        if (!instance.allowCommandMessage(player)) return true;
        return instance.enforceManagedCommandAccess(player, commandLine);
    }

    /** Supplies the permission view used to build the client's command tree. */
    public static CommandSourceStack commandTreeSource(ServerPlayer player) {
        CommandSourceStack source = player.createCommandSourceStack();
        ServerProtectionFabric instance = active;
        if (instance == null) return source;
        FabricAccessPolicy.CommandTreeMode mode = instance.accessPolicy.commandTreeMode(
                player.getGameProfile().name(), player.getUUID());
        return switch (mode) {
            case VANILLA -> source;
            case RESTRICTED -> source.withPermission(PermissionSet.NO_PERMISSIONS);
            case ELEVATED -> source.withPermission(PermissionSet.ALL_PERMISSIONS);
        };
    }

    /**
     * Removes managed command roots the player cannot execute before the tree reaches their
     * client.  Permission elevation is still used while vanilla copies an allowed root's child
     * arguments, but it no longer leaks every unrelated admin command into autocomplete.
     */
    public static RootCommandNode<CommandSourceStack> buildCommandTree(
            ServerPlayer player, RootCommandNode<CommandSourceStack> dispatcherRoot) {
        if (player == null || dispatcherRoot == null) return new RootCommandNode<>();
        CommandSourceStack source = commandTreeSource(player);
        String playerName = player.getGameProfile().name();
        UUID playerId = player.getUUID();
        ServerProtectionFabric instance = active;
        return CommandTreePruner.copy(dispatcherRoot, source, root -> instance == null
                || instance.accessPolicy.canSeeCommandRoot(playerName, playerId, root, true),
                path -> instance == null || instance.accessPolicy.canSeeCommandPath(playerName, playerId, path));
    }

    /** Thread-safe packet/mixin query; active viewer ids are held in a concurrent set. */
    public static boolean isPlayerViewActive(ServerPlayer player) {
        ServerProtectionFabric instance = active;
        return instance != null && instance.playerViews.isViewing(player);
    }

    /**
     * Server suggestion packets are untrusted requests and must not bypass the command tree that
     * was sent to this player. This decision reads only the immutable policy snapshot and concurrent
     * active-view set so the 26.3 networking path can safely reject a request before its provider
     * schedules Brigadier work onto the server tick.
     */
    public static boolean allowCommandSuggestions(ServerPlayer player, String commandLine) {
        ServerProtectionFabric instance = active;
        if (instance == null || player == null) return true;

        String literalRoot = literalCommandRoot(commandLine);
        if (literalRoot.isEmpty()) return false;
        FabricAccessPolicy.CommandDecision decision = instance.accessPolicy.suggestionDecision(
                player.getGameProfile().name(), player.getUUID(), commandLine);
        return shouldAllowCommandSuggestions(instance.playerViews.isViewing(player), decision,
                instance.accessPolicy.enforcesPrivilegedRoles());
    }

    /**
     * Brigadier completion enumerates children without checking their requirements. Shared public
     * roots therefore need the filtered tree for remote suggestions as well as the client tree.
     * Scheduling here also keeps the 26.3 network-thread callback away from mutable command state.
     */
    public static boolean handleSharedTeamSuggestions(ServerPlayer player, int requestId, String commandLine) {
        String root = AccessPolicy.commandRoot(commandLine);
        ServerProtectionFabric instance = active;
        if (instance == null || player == null || (!root.equals("team") && !root.equals("create"))) return false;
        MinecraftServer currentServer = instance.server;
        if (currentServer == null) return false;
        Runnable respond = () -> {
            if (player.hasDisconnected()) return;
            if (commandLine == null || commandLine.length() > 2048 || !allowCommandSuggestions(player, commandLine)) {
                player.connection.send(new ClientboundCommandSuggestionsPacket(requestId, 0, 0, List.of()));
                return;
            }
            CommandSourceStack source = commandTreeSource(player);
            var filtered = CommandTreePruner.copy(currentServer.getCommands().getDispatcher().getRoot(), source,
                    name -> name.equals(root) && instance.accessPolicy.canSeeCommandRoot(
                            player.getGameProfile().name(), player.getUUID(), name, true),
                    path -> instance.accessPolicy.canSeeCommandPath(player.getGameProfile().name(), player.getUUID(), path));
            CommandDispatcher<CommandSourceStack> dispatcher = new CommandDispatcher<>(filtered);
            StringReader reader = new StringReader(commandLine);
            if (reader.canRead() && reader.peek() == '/') reader.skip();
            dispatcher.getCompletionSuggestions(dispatcher.parse(reader, source)).whenComplete((suggestions, error) -> {
                Runnable deliver = () -> {
                    if (player.hasDisconnected()) return;
                    if (error != null || !allowCommandSuggestions(player, commandLine)) {
                        player.connection.send(new ClientboundCommandSuggestionsPacket(requestId, 0, 0, List.of()));
                        return;
                    }
                    Suggestions bounded = new Suggestions(suggestions.getRange(), suggestions.getList().stream().limit(1000).toList());
                    player.connection.send(new ClientboundCommandSuggestionsPacket(requestId, bounded));
                };
                if (currentServer.isSameThread()) deliver.run(); else currentServer.execute(deliver);
            });
        };
        if (currentServer.isSameThread()) respond.run(); else currentServer.execute(respond);
        return true;
    }

    static boolean shouldAllowCommandSuggestions(boolean activeView,
                                                  FabricAccessPolicy.CommandDecision decision,
                                                  boolean managedPrivilegesActive) {
        if (activeView || decision == null || decision == FabricAccessPolicy.CommandDecision.DENY) return false;
        if (decision == FabricAccessPolicy.CommandDecision.ELEVATE
                || decision == FabricAccessPolicy.CommandDecision.BASELINE) return true;
        // Once managed privileges are authoritative, an unassigned stale native op receives no
        // server-side completions even for a forged root that was absent from their pruned tree.
        return !managedPrivilegesActive;
    }

    /**
     * Parses signed commands with a complete tree while a managed policy is authoritative. This
     * happens before vanilla discovers and verifies signable arguments. The command is reparsed
     * with its exact managed permission set after vanilla attaches the verified signing context.
     */
    public static ParseResults<CommandSourceStack> parseSignedCommand(ServerPlayer player,
                                                                       String commandLine) {
        CommandSourceStack source = player.createCommandSourceStack();
        ServerProtectionFabric instance = active;
        MinecraftServer currentServer = instance == null ? player.level().getServer() : instance.server;
        if (currentServer == null) currentServer = player.level().getServer();

        if (instance != null) {
            String clean = cleanCommand(commandLine);
            FabricAccessPolicy.CommandDecision decision = instance.accessPolicy.commandDecision(
                    player.getGameProfile().name(), player.getUUID(), clean);
            if (decision != FabricAccessPolicy.CommandDecision.VANILLA
                    || instance.accessPolicy.enforcesPrivilegedRoles()) {
                source = source.withPermission(PermissionSet.ALL_PERMISSIONS);
            }
        }
        return currentServer.getCommands().getDispatcher()
                .parse(String.valueOf(commandLine == null ? "" : commandLine), source);
    }

    /** Applies command spam/access policy after vanilla has verified every signed argument. */
    public static void performSignedCommand(ServerPlayer player, Commands commands,
                                            ParseResults<CommandSourceStack> parsedCommand,
                                            String commandLine) {
        ServerProtectionFabric instance = active;
        if (instance == null || player == null || commands == null || parsedCommand == null) {
            if (commands != null && parsedCommand != null) {
                commands.performCommand(parsedCommand, commandLine);
            }
            return;
        }
        instance.performSignedCommandInternal(player, commands, parsedCommand, commandLine);
    }

    private void performSignedCommandInternal(ServerPlayer player, Commands commands,
                                              ParseResults<CommandSourceStack> parsedCommand,
                                              String commandLine) {
        if (handleActiveViewCommand(player, commandLine)) return;
        if (handlePlayerViewCommandInternal(player, commandLine)) return;
        if (handlePlayerInfoCommandInternal(player, commandLine)) return;
        if (!allowCommandMessage(player)) return;

        String clean = cleanCommand(commandLine);
        FabricAccessPolicy.CommandDecision decision = accessPolicy.commandDecision(
                player.getGameProfile().name(), player.getUUID(), clean);
        boolean restrictUnassigned = decision == FabricAccessPolicy.CommandDecision.VANILLA
                && accessPolicy.enforcesPrivilegedRoles();
        if (decision == FabricAccessPolicy.CommandDecision.VANILLA && !restrictUnassigned) {
            commands.performCommand(parsedCommand, commandLine);
            return;
        }
        if (decision == FabricAccessPolicy.CommandDecision.DENY || !isSafeManagedCommand(clean)) {
            player.sendSystemMessage(accessDeniedMessage());
            return;
        }

        try {
            PermissionSet permissions = decision == FabricAccessPolicy.CommandDecision.ELEVATE
                    ? PermissionSet.ALL_PERMISSIONS : PermissionSet.NO_PERMISSIONS;
            // Vanilla has already mapped its verified signing context onto this root source.
            // Reparse so Brigadier evaluates every .requires(...) predicate with the managed
            // permission set instead of the player's stale native operator state.
            CommandSourceStack managedSource = parsedCommand.getContext().getSource()
                    .withPermission(permissions);
            ParseResults<CommandSourceStack> managed = commands.getDispatcher().parse(clean, managedSource);
            if (restrictUnassigned && shouldDenyUnassignedManagedCommand(true, managed)) {
                player.sendSystemMessage(accessDeniedMessage());
                return;
            }
            commands.performCommand(managed, clean);
        } catch (RuntimeException error) {
            LOGGER.warn("Managed signed command '{}' failed for {}: {}",
                    AccessPolicy.commandRoot(clean), player.getGameProfile().name(), error.getMessage());
            player.sendSystemMessage(Component.literal("That command could not be completed."));
        }
    }

    private boolean handlePlayerViewCommandInternal(ServerPlayer player, String commandLine) {
        String clean = String.valueOf(commandLine == null ? "" : commandLine).trim();
        if (clean.startsWith("/")) clean = clean.substring(1).trim();
        if (clean.isEmpty() || clean.length() > 256) return false;
        String[] parts = clean.split("\\s+", 3);
        String root = parts[0].toLowerCase(Locale.ROOT);
        int separator = root.indexOf(':');
        if (separator >= 0) {
            String namespace = root.substring(0, separator);
            if (!namespace.equals(MOD_ID)) return false;
            root = root.substring(separator + 1);
        }
        if (!root.equals("ci-spectate") && !root.equals("ci-unspectate")
                && !root.equals("unspectate")) return false;
        String playerName = player.getGameProfile().name();
        UUID playerId = player.getUUID();
        if (accessPolicy.assignmentFor(playerName, playerId).isEmpty()) return false;
        if (!accessPolicy.canUsePlayerView(playerName, playerId, root)) {
            player.sendSystemMessage(accessDeniedMessage());
            return true;
        }
        if (!root.equals("ci-spectate")) {
            FabricSpectateController.Result result = parts.length == 1
                    ? playerViews.restore(player)
                    : FabricSpectateController.Result.fail("Usage: /ci-unspectate");
            player.sendSystemMessage(Component.literal(result.message()));
            return true;
        }
        if (parts.length != 2 || !parts[1].matches("[A-Za-z0-9_]{1,16}")) {
            player.sendSystemMessage(Component.literal("Usage: /ci-spectate <online-player>"));
            return true;
        }
        ServerPlayer target = server == null ? null : server.getPlayerList().getPlayerByName(parts[1]);
        FabricSpectateController.Result result = playerViews.begin(player, target);
        player.sendSystemMessage(Component.literal(result.message()));
        return true;
    }

    private boolean handleActiveViewCommand(ServerPlayer player, String commandLine) {
        if (!playerViews.isViewing(player)) return false;
        if (!isPlayerViewControlCommand(commandLine)) {
            player.sendSystemMessage(Component.literal(
                    "Only /ci-unspectate or /ci-spectate <player> may be used while viewing a player."));
            return true;
        }
        // Consume the control root even if a concurrent policy reload revoked its assignment.
        // It must never fall through to vanilla or another mod while the viewer is relocated.
        if (!handlePlayerViewCommandInternal(player, commandLine)) {
            player.sendSystemMessage(accessDeniedMessage());
        }
        return true;
    }

    static boolean isPlayerViewControlCommand(String commandLine) {
        if (cleanCommand(commandLine).length() > 256) return false;
        String root = literalCommandRoot(commandLine);
        if (root.isEmpty()) return false;
        int separator = root.indexOf(':');
        if (separator >= 0) {
            if (!root.substring(0, separator).equals(MOD_ID)) return false;
            root = root.substring(separator + 1);
        }
        return root.equals("ci-spectate") || root.equals("ci-unspectate") || root.equals("unspectate");
    }

    static String literalCommandRoot(String commandLine) {
        String clean = cleanCommand(commandLine);
        if (clean.isEmpty() || clean.length() > 2_048) return "";
        int end = 0;
        while (end < clean.length() && !Character.isWhitespace(clean.charAt(end))) {
            if (Character.isISOControl(clean.charAt(end))) return "";
            end++;
        }
        return clean.substring(0, end).toLowerCase(Locale.ROOT);
    }

    private boolean handlePlayerInfoCommandInternal(ServerPlayer player, String commandLine) {
        String clean = String.valueOf(commandLine == null ? "" : commandLine).trim();
        if (clean.startsWith("/")) clean = clean.substring(1).trim();
        if (clean.isEmpty() || clean.length() > 256) return false;
        String[] parts = clean.split("\\s+", 4);
        String root = parts[0].toLowerCase(Locale.ROOT);
        int separator = root.indexOf(':');
        if (separator >= 0) {
            String namespace = root.substring(0, separator);
            if (!namespace.equals(MOD_ID)) return false;
            root = root.substring(separator + 1);
        }
        if (!root.equals("view")) return false;
        if (accessPolicy.assignmentFor(player.getGameProfile().name(), player.getUUID()).isEmpty()) return false;
        if (parts.length != 3 || !parts[2].matches("[A-Za-z0-9_]{1,16}")) {
            player.sendSystemMessage(Component.literal("Usage: /view coordinate <player> or /view dimension <player>"));
            return true;
        }
        String action = parts[1].toLowerCase(Locale.ROOT);
        String capability = switch (action) {
            case "coordinate" -> AccessPolicy.PLAYER_COORDINATES;
            case "dimension" -> AccessPolicy.PLAYER_DIMENSION;
            default -> "";
        };
        if (capability.isEmpty()) {
            player.sendSystemMessage(Component.literal("Usage: /view coordinate <player> or /view dimension <player>"));
            return true;
        }
        if (accessPolicy.explicitlyDenies(player.getGameProfile().name(), player.getUUID(), root)
                || !accessPolicy.hasCapability(player.getGameProfile().name(), player.getUUID(), capability)) {
            player.sendSystemMessage(accessDeniedMessage());
            return true;
        }
        sendPlayerInfo(player.createCommandSourceStack(), parts[2], action);
        return true;
    }

    private boolean enforceManagedCommandAccess(ServerPlayer player, String commandLine) {
        String clean = cleanCommand(commandLine);
        FabricAccessPolicy.CommandDecision decision = accessPolicy.commandDecision(
                player.getGameProfile().name(), player.getUUID(), clean);
        boolean restrictUnassigned = decision == FabricAccessPolicy.CommandDecision.VANILLA
                && accessPolicy.enforcesPrivilegedRoles();
        if (decision == FabricAccessPolicy.CommandDecision.VANILLA && !restrictUnassigned) return false;
        if (decision == FabricAccessPolicy.CommandDecision.DENY || !isSafeManagedCommand(clean)) {
            player.sendSystemMessage(accessDeniedMessage());
            return true;
        }
        MinecraftServer currentServer = server;
        if (currentServer == null) {
            player.sendSystemMessage(Component.literal("The server command dispatcher is not ready."));
            return true;
        }
        try {
            PermissionSet permissions = decision == FabricAccessPolicy.CommandDecision.ELEVATE
                    ? PermissionSet.ALL_PERMISSIONS : PermissionSet.NO_PERMISSIONS;
            CommandSourceStack managedSource = player.createCommandSourceStack().withPermission(permissions);
            ParseResults<CommandSourceStack> managed = currentServer.getCommands()
                    .getDispatcher().parse(clean, managedSource);
            if (restrictUnassigned && shouldDenyUnassignedManagedCommand(true, managed)) {
                player.sendSystemMessage(accessDeniedMessage());
                return true;
            }
            // Retain player identity, position, and output while replacing only permissions.
            // Cancelling the packet afterwards guarantees vanilla cannot execute it a second time
            // with a stale native operator permission set.
            currentServer.getCommands().performCommand(managed, clean);
        } catch (RuntimeException error) {
            LOGGER.warn("Managed command '{}' failed for {}: {}",
                    AccessPolicy.commandRoot(clean), player.getGameProfile().name(), error.getMessage());
            player.sendSystemMessage(Component.literal("That command could not be completed."));
        }
        return true;
    }

    static String cleanCommand(String commandLine) {
        String clean = String.valueOf(commandLine == null ? "" : commandLine).strip();
        while (clean.startsWith("/")) clean = clean.substring(1).stripLeading();
        return clean;
    }

    static boolean isCompleteCommandParse(ParseResults<?> parsed) {
        return parsed != null && parsed.getContext().getCommand() != null
                && !parsed.getReader().canRead();
    }

    static boolean shouldDenyUnassignedManagedCommand(boolean managedPrivilegesActive,
                                                       ParseResults<?> restrictedParse) {
        return managedPrivilegesActive && !isCompleteCommandParse(restrictedParse);
    }

    private Component accessDeniedMessage() {
        return FabricMessageComponent.parse(accessPolicy.deniedMessage());
    }

    static boolean isSafeManagedCommand(String commandLine) {
        if (commandLine == null || commandLine.isBlank() || commandLine.length() > 2_048) return false;
        for (int index = 0; index < commandLine.length(); index++) {
            if (Character.isISOControl(commandLine.charAt(index))) return false;
        }
        return true;
    }

    private boolean allowCommandMessage(ServerPlayer player) {
        ProtectionConfig current = config;
        if (!ready(current) || !current.checks().commandSpam()
                || isCheckExempt(player, Check.COMMAND_SPAM)) return true;
        long now = System.currentTimeMillis();
        PlayerSession session = session(player, now, current);
        if (abuseActivityExempt(player, session, now)) return true;
        ActivityAnalyzer.Assessment result = session.activity.command(
                now, current.abuse().maxCommandsPerFiveSeconds());
        if (!result.violation()) return true;
        String reason = "Sent " + result.count() + " commands in five seconds";
        report(player, session, Check.COMMAND_SPAM, 1.0, reason,
                Map.of("count", result.count(), "limit", result.limit()), now);
        return !current.responseEnabled();
    }

    private boolean allowInventoryAction(ServerPlayer player, boolean helperCompatible) {
        ProtectionConfig current = config;
        if (!ready(current) || !current.checks().inventorySpam() || player == null
                || isCheckExempt(player, Check.INVENTORY_SPAM)) return true;
        long now = System.currentTimeMillis();
        PlayerSession session = session(player, now, current);
        if (abuseActivityExempt(player, session, now)) return true;
        ProtectionConfig.AbuseLimits limits = current.abuse();
        int compatibilityMultiplier = helperCompatible ? 4 : 1;
        InventoryActivityAnalyzer.Assessment result = session.inventory.observe(
                now,
                Math.multiplyExact(limits.maxInventoryClicksPerSecond(), compatibilityMultiplier),
                limits.inventoryEvidenceSamples(),
                limits.inventorySampleIntervalMillis(),
                limits.inventoryEvidenceWindowMillis(),
                Math.multiplyExact(limits.maxInventoryBurstPacketsPerSecond(), compatibilityMultiplier),
                limits.inventoryViolationCooldownMillis());
        if (!result.confirmed()) return true;
        if (result.report()) {
            String reason = result.hardFlood()
                    ? "Inventory packet flood reached " + result.count() + " packets in one second"
                    : "Sustained inventory activity exceeded " + result.rateLimit()
                            + " packets per second across " + result.evidenceSamples() + " evidence samples";
            double amount = result.hardFlood()
                    ? 3.0 + Math.min(5.0, (result.count() - result.hardLimit()) * 0.05)
                    : 0.8 + Math.min(2.0, (result.count() - result.rateLimit()) * 0.05);
            report(player, session, Check.INVENTORY_SPAM, amount, reason,
                    Map.of("count", result.count(),
                            "limit", result.rateLimit(),
                            "evidenceSamples", result.evidenceSamples(),
                            "requiredEvidenceSamples", result.requiredEvidenceSamples(),
                            "hardLimit", result.hardLimit(),
                            "hardFlood", result.hardFlood()), now);
        }
        if (!current.responseEnabled()) return true;
        if (session.allowInventoryResync(now)) player.containerMenu.sendAllDataToRemote();
        return false;
    }

    private boolean ready(ProtectionConfig current) {
        return current != null && current.enabled() && offenses != null && eventLogger != null;
    }

    private boolean worldActivityExempt(ServerPlayer player, PlayerSession session, long now) {
        return isProtectionExempt(player) || player.isCreative() || player.isSpectator()
                || player.isPassenger() || player.getAbilities().mayfly || now < session.graceUntil;
    }

    private boolean abuseActivityExempt(ServerPlayer player, PlayerSession session, long now) {
        return isProtectionExempt(player) || now < session.graceUntil;
    }

    private void report(ServerPlayer player, PlayerSession session, Check check, double amount,
                        String reason, Map<String, ?> details, long now) {
        if (isCheckExempt(player, check)) return;
        if (!session.allowDetection(check.ordinal(), now)) return;
        ProtectionConfig current = config;
        if (current == null || offenses == null || eventLogger == null) return;
        UUID playerId = player.getUUID();
        int prior = offenses.priorOffenseCount(playerId, current.violationPolicy().offenseDecayMillis());
        OffenseRecord record = offenses.observe(playerId, player.getGameProfile().name(), check.id, reason);
        ViolationDecision decision = violations.report(playerId, check.id, amount, prior,
                current.violationPolicy(), current.responseEnabled());
        if (decision.action() != EnforcementAction.NONE) {
            record = offenses.punish(playerId, decision.action(), decision.durationSeconds(), decision.countsAsOffense());
            enforce(player, check.id, decision.action(), reason, decision.violations(),
                    record.offenseCount(), decision.durationSeconds());
        } else if (current.responseEnabled() && current.warnBeforeThreshold()
                && now - session.lastPreWarningAt >= current.warningCooldownMillis()) {
            session.lastPreWarningAt = now;
            player.sendSystemMessage(message(current.messages().warningFor(check.id),
                    enforcementMessageValues(player.getGameProfile().name(), check.id, reason,
                            "warn", decision.violations(), record.offenseCount(), 0)));
        }
        eventLogger.event(player.getGameProfile().name(), playerId, check.id, check.category,
                decision.action(), reason, decision.violations(), record.offenseCount(),
                decision.durationSeconds(), details);
    }

    /** Records advisory client reports without feeding them into VL/offense escalation. */
    private void handleClientAttestationOutcome(ClientAttestationSessions.Outcome outcome) {
        EventLogger logger = eventLogger;
        MinecraftServer currentServer = server;
        if (logger == null || currentServer == null || outcome == null) return;
        ServerPlayer player = currentServer.getPlayerList().getPlayer(outcome.playerId());
        if (player == null || antiCheatExemptions.contains(player.getUUID())) return;

        ClientModPolicy.Decision decision = outcome.decision();
        ClientModPolicy policy = clientAttestation.policy();
        boolean violation = decision != null && decision.violatesPolicy();
        EnforcementAction action = violation
                ? policy.enforcement() == ClientModPolicy.Enforcement.KICK
                        ? EnforcementAction.KICK : EnforcementAction.ALERT
                : EnforcementAction.NONE;
        AttestationProtocol.Report report = outcome.report();
        String matchedMod = decision == null ? "" : decision.modId();
        String reason = clientModPolicyReason(outcome, decision);
        String playerName = player.getGameProfile().name();
        logger.event(playerName, player.getUUID(), "compatibility.modPolicy", "compatibility",
                action, reason, 0.0, 0, 0, Map.of(
                        "advisory", true,
                        "transportFresh", report != null,
                        "status", outcome.state().name().toLowerCase(Locale.ROOT),
                        "reporterVersion", report == null ? "" : report.reporterVersion(),
                        "modCount", report == null ? 0 : report.mods().size(),
                        "truncated", report != null && report.truncated(),
                        "matchedModId", matchedMod));

        if (action == EnforcementAction.KICK) {
            ProtectionConfig current = config;
            if (current == null) return;
            Map<String, Object> values = enforcementMessageValues(
                    playerName, "compatibility.modPolicy", reason, action.wireName(), 0.0, 0, 0);
            player.connection.disconnect(message(current.messages().modPolicyKick(), values));
        }
    }

    private static String clientModPolicyReason(ClientAttestationSessions.Outcome outcome,
                                                 ClientModPolicy.Decision decision) {
        if (decision == null) return "Client mod report was unavailable; client remains unverified";
        return switch (decision.violation()) {
            case NONE -> outcome.report() == null
                    ? "No fresh companion report was received; client remains unverified, not proven cheating"
                    : "Companion reported " + outcome.report().mods().size()
                            + " mod(s); advisory only, not proof of a clean client";
            case MISSING_REPORT -> "No fresh companion report was received; client remains unverified, not proven cheating";
            case INCOMPLETE_REPORT -> "Companion mod report was truncated; client remains unverified";
            case BLOCKED_MOD_REPORTED -> "Companion reported blocked mod " + decision.modId()
                    + "; the report is client-controlled";
            case MOD_OUTSIDE_ALLOWLIST_REPORTED -> "Companion reported mod outside the allowlist: "
                    + decision.modId() + "; the report is client-controlled";
        };
    }

    private void enforce(ServerPlayer player, String check, EnforcementAction action,
                         String reason, double violations, int offenseCount, int durationSeconds) {
        ProtectionConfig current = config;
        if (current == null) return;
        Map<String, Object> values = enforcementMessageValues(
                player.getGameProfile().name(), check, reason, action.wireName(),
                violations, offenseCount, durationSeconds);
        switch (action) {
            case ALERT -> player.sendSystemMessage(message(current.messages().alert(), values));
            case KICK -> player.connection.disconnect(message(current.messages().kick(), values));
            case TEMP_BAN -> player.connection.disconnect(message(current.messages().temporaryBan(), values));
            case PERMANENT_BAN -> player.connection.disconnect(message(current.messages().permanentBan(), values));
            case NONE -> { }
        }
    }

    static Map<String, Object> enforcementMessageValues(String player, String check, String reason,
                                                         String action, double violations,
                                                         int offenseCount, int durationSeconds) {
        int safeDuration = Math.max(0, durationSeconds);
        return Map.of(
                "player", player == null ? "" : player,
                "check", check == null ? "" : check,
                "reason", reason == null ? "" : reason,
                "action", action == null ? "" : action,
                "violations", decimal(Math.max(0.0, violations)),
                "offenses", Math.max(0, offenseCount),
                "duration_seconds", safeDuration,
                "duration_minutes", safeDuration == 0 ? 0 : Math.max(1, safeDuration / 60));
    }

    private LiteralArgumentBuilder<CommandSourceStack> command(String name) {
        return Commands.literal(name)
                .requires(source -> source.permissions().hasPermission(Permissions.COMMANDS_ADMIN)
                        || canUseManagedCommand(source.getPlayer(), name))
                .executes(context -> status(context.getSource()))
                .then(Commands.literal("status").executes(context -> status(context.getSource())))
                .then(Commands.literal("reload").executes(context -> reload(context.getSource())))
                .then(Commands.literal("mods")
                        .then(Commands.argument("player", StringArgumentType.word())
                                .executes(context -> modStatus(context.getSource(),
                                        StringArgumentType.getString(context, "player")))))
                .then(Commands.literal("view")
                        .then(Commands.literal("start")
                                .then(Commands.argument("viewer", StringArgumentType.word())
                                        .then(Commands.argument("target", StringArgumentType.word())
                                                .executes(context -> startPlayerView(
                                                        context.getSource(),
                                                        StringArgumentType.getString(context, "viewer"),
                                                        StringArgumentType.getString(context, "target"))))))
                        .then(Commands.literal("stop")
                                .then(Commands.argument("viewer", StringArgumentType.word())
                                        .executes(context -> stopPlayerView(
                                                context.getSource(),
                                                StringArgumentType.getString(context, "viewer"))))))
                .then(Commands.literal("pardon")
                        .then(Commands.argument("player", StringArgumentType.word())
                                .executes(context -> pardon(context.getSource(),
                                        StringArgumentType.getString(context, "player")))));
    }

    private LiteralArgumentBuilder<CommandSourceStack> antiCheatCommand() {
        return Commands.literal("anticheat")
                .requires(this::canManageAntiCheat)
                .executes(context -> antiCheatOverview(context.getSource()))
                .then(Commands.literal("disable")
                        .then(Commands.argument("player", StringArgumentType.word())
                                .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                        antiCheatSuggestions(false), builder))
                                .executes(context -> setAntiCheatExemption(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "player"), true))))
                .then(Commands.literal("enable")
                        .then(Commands.argument("player", StringArgumentType.word())
                                .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                        antiCheatSuggestions(true), builder))
                                .executes(context -> setAntiCheatExemption(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "player"), false))))
                .then(Commands.literal("status")
                        .executes(context -> antiCheatOverview(context.getSource()))
                        .then(Commands.argument("player", StringArgumentType.word())
                                .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                        antiCheatSuggestions(true), builder))
                                .executes(context -> antiCheatPlayerStatus(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "player")))))
                .then(Commands.literal("list")
                        .executes(context -> listAntiCheatExemptions(context.getSource(), 1))
                        .then(Commands.argument("page", IntegerArgumentType.integer(1))
                                .executes(context -> listAntiCheatExemptions(
                                        context.getSource(),
                                        IntegerArgumentType.getInteger(context, "page")))));
    }

    private boolean canManageAntiCheat(CommandSourceStack source) {
        ServerPlayer player = source.getPlayer();
        if (player == null) return true;
        if (source.permissions().hasPermission(Permissions.COMMANDS_ADMIN)) return true;
        return accessPolicy.hasCapability(player.getGameProfile().name(), player.getUUID(),
                AccessPolicy.PROTECTION_MANAGE);
    }

    private int antiCheatOverview(CommandSourceStack source) {
        int count = antiCheatExemptions.snapshot().size();
        source.sendSuccess(() -> Component.literal("Per-player anti-cheat: " + count
                + " persistent exemption(s). Use /anticheat disable <player>, "
                + "/anticheat enable <player>, /anticheat status <player>, or /anticheat list."), false);
        return 1;
    }

    private int setAntiCheatExemption(CommandSourceStack source, String selector, boolean disabled) {
        ResolvedProtectionPlayer target = resolveProtectionPlayer(selector, !disabled);
        if (target == null) {
            source.sendFailure(Component.literal(disabled
                    ? "Use an exact online player name or a full UUID."
                    : "Use an exact online player name, exempted player name, or full UUID."));
            return 0;
        }
        try {
            boolean changed = disabled
                    ? antiCheatExemptions.disable(target.playerId(), target.name())
                    : antiCheatExemptions.enable(target.playerId());
            resetAntiCheatState(target.playerId());
            ServerPlayer online = server == null ? null : server.getPlayerList().getPlayer(target.playerId());
            int refreshedChunks = refreshPacketAntiXrayState(online);
            String display = target.displayName();
            if (!changed) {
                source.sendSuccess(() -> Component.literal("Anti-cheat is already "
                        + (disabled ? "disabled" : "enabled") + " for " + display + "."
                        + refreshMessage(refreshedChunks)), false);
                return 1;
            }
            source.sendSuccess(() -> Component.literal("Anti-cheat "
                    + (disabled ? "disabled" : "enabled") + " for " + display
                    + (disabled
                            ? ". Packet Anti-Xray is bypassed for this player; access control and other server features remain active."
                            : ". Detection and packet Anti-Xray resume with fresh transient evidence.")
                    + refreshMessage(refreshedChunks)), true);
            return 1;
        } catch (IOException error) {
            source.sendFailure(Component.literal("Could not persist the anti-cheat exemption: "
                    + error.getMessage()));
            LOGGER.error("Could not persist per-player anti-cheat exemption for {}: {}",
                    target.playerId(), error.getMessage());
            return 0;
        }
    }

    private int refreshPacketAntiXrayState(ServerPlayer player) {
        if (player == null || player.connection == null) return 0;
        try {
            if (FabricLoader.getInstance().isModLoaded("meowantixray")) {
                // Clear the provider's remembered masked-block state before raw or newly-obfuscated
                // chunk packets are queued. The mixin bypass then stays internally consistent.
                MeowAntiXrayMod.fakeOre().onPlayerDisconnect(player);
            }
        } catch (RuntimeException | LinkageError error) {
            LOGGER.warn("Could not clear packet Anti-Xray state for {}: {}",
                    player.getGameProfile().name(), error.getMessage());
        }

        ServerLevel level = player.level();
        var chunkSource = level.getChunkSource();
        ChunkPos center = player.chunkPosition();
        int radius = Math.max(2, Math.min(32,
                server == null ? 10 : server.getPlayerList().getViewDistance()));
        int queued = 0;
        for (int chunkX = center.x() - radius; chunkX <= center.x() + radius; chunkX++) {
            for (int chunkZ = center.z() - radius; chunkZ <= center.z() + radius; chunkZ++) {
                if (!chunkSource.chunkMap.isChunkTracked(player, chunkX, chunkZ)) continue;
                LevelChunk chunk = chunkSource.getChunkNow(chunkX, chunkZ);
                if (chunk == null) continue;
                player.connection.chunkSender.markChunkPendingToSend(chunk);
                queued++;
            }
        }
        return queued;
    }

    private static String refreshMessage(int refreshedChunks) {
        return refreshedChunks > 0
                ? " Refreshing " + refreshedChunks + " currently tracked chunk(s)."
                : " The setting will apply to newly sent chunks.";
    }

    private int antiCheatPlayerStatus(CommandSourceStack source, String selector) {
        ResolvedProtectionPlayer target = resolveProtectionPlayer(selector, true);
        if (target == null) {
            source.sendFailure(Component.literal(
                    "Use an exact online player name, exempted player name, or full UUID."));
            return 0;
        }
        boolean disabled = antiCheatExemptions.contains(target.playerId());
        source.sendSuccess(() -> Component.literal("Anti-cheat is "
                + (disabled ? "disabled" : "enabled") + " for " + target.displayName()
                + " (" + target.playerId() + ")."), false);
        return 1;
    }

    private int listAntiCheatExemptions(CommandSourceStack source, int page) {
        final int pageSize = 20;
        List<AntiCheatExemptionStore.Entry> entries = antiCheatExemptions.snapshot();
        int pages = Math.max(1, (entries.size() + pageSize - 1) / pageSize);
        if (page > pages) {
            source.sendFailure(Component.literal("Page must be between 1 and " + pages + "."));
            return 0;
        }
        int start = (page - 1) * pageSize;
        int end = Math.min(entries.size(), start + pageSize);
        StringBuilder message = new StringBuilder("Anti-cheat exemptions ")
                .append(page).append('/').append(pages).append(" (")
                .append(entries.size()).append(" total)");
        for (int index = start; index < end; index++) {
            AntiCheatExemptionStore.Entry entry = entries.get(index);
            message.append("\n- ").append(entry.displayName())
                    .append(" (").append(entry.playerId()).append(')');
        }
        source.sendSuccess(() -> Component.literal(message.toString()), false);
        return 1;
    }

    private List<String> antiCheatSuggestions(boolean includeExemptions) {
        LinkedHashMap<String, String> suggestions = new LinkedHashMap<>();
        MinecraftServer currentServer = server;
        if (currentServer != null) {
            for (ServerPlayer player : currentServer.getPlayerList().getPlayers()) {
                String name = player.getGameProfile().name();
                suggestions.putIfAbsent(name.toLowerCase(Locale.ROOT), name);
            }
        }
        if (includeExemptions) {
            for (AntiCheatExemptionStore.Entry entry : antiCheatExemptions.snapshot()) {
                String value = entry.displayName();
                suggestions.putIfAbsent(value.toLowerCase(Locale.ROOT), value);
            }
        }
        ArrayList<String> sorted = new ArrayList<>(suggestions.values());
        sorted.sort(String.CASE_INSENSITIVE_ORDER);
        return List.copyOf(sorted);
    }

    private ResolvedProtectionPlayer resolveProtectionPlayer(String selector, boolean includeExemptions) {
        if (selector == null || selector.isBlank() || selector.length() > 64) return null;
        String exact = selector.trim();
        UUID playerId = null;
        try {
            playerId = UUID.fromString(exact);
        } catch (IllegalArgumentException ignored) {
            // Exact online names and persisted last-known names are handled below.
        }
        MinecraftServer currentServer = server;
        if (playerId != null) {
            ServerPlayer online = currentServer == null ? null : currentServer.getPlayerList().getPlayer(playerId);
            AntiCheatExemptionStore.Entry stored = antiCheatExemptions.get(playerId);
            String name = online != null ? online.getGameProfile().name()
                    : stored == null ? "" : stored.name();
            return new ResolvedProtectionPlayer(playerId, name);
        }
        if (!exact.matches("[A-Za-z0-9_]{1,16}")) return null;
        ServerPlayer online = currentServer == null ? null : currentServer.getPlayerList().getPlayerByName(exact);
        if (online != null && online.getGameProfile().name().equalsIgnoreCase(exact)) {
            return new ResolvedProtectionPlayer(online.getUUID(), online.getGameProfile().name());
        }
        if (!includeExemptions) return null;
        AntiCheatExemptionStore.Entry stored = antiCheatExemptions.findByExactName(exact);
        return stored == null ? null : new ResolvedProtectionPlayer(stored.playerId(), stored.name());
    }

    private void resetAntiCheatState(UUID playerId) {
        sessions.remove(playerId);
        violations.forgive(playerId);
    }

    private LiteralArgumentBuilder<CommandSourceStack> playerInfoCommand() {
        return Commands.literal("view")
                .then(Commands.literal("coordinate")
                        .requires(source -> canViewPlayerInfo(source, AccessPolicy.PLAYER_COORDINATES))
                        .then(Commands.argument("player", StringArgumentType.word())
                                .executes(context -> sendPlayerInfo(context.getSource(),
                                        StringArgumentType.getString(context, "player"), "coordinate"))))
                .then(Commands.literal("dimension")
                        .requires(source -> canViewPlayerInfo(source, AccessPolicy.PLAYER_DIMENSION))
                        .then(Commands.argument("player", StringArgumentType.word())
                                .executes(context -> sendPlayerInfo(context.getSource(),
                                        StringArgumentType.getString(context, "player"), "dimension"))));
    }

    private LiteralArgumentBuilder<CommandSourceStack> entityAdminCommand() {
        return Commands.literal("entityadmin")
                .requires(this::canUseEntityAdmin)
                .executes(context -> sendEntityAdminHelp(context.getSource()))
                .then(Commands.literal("help")
                        .executes(context -> sendEntityAdminHelp(context.getSource())));
    }

    private boolean canUsePlayerViewCommand(CommandSourceStack source, String commandRoot) {
        ServerPlayer player = source.getPlayer();
        if (player == null) return source.permissions().hasPermission(Permissions.COMMANDS_ADMIN);
        String playerName = player.getGameProfile().name();
        UUID playerId = player.getUUID();
        return accessPolicy.canUsePlayerView(playerName, playerId, commandRoot);
    }

    private boolean canUseEntityAdmin(CommandSourceStack source) {
        ServerPlayer player = source.getPlayer();
        if (player == null) return source.permissions().hasPermission(Permissions.COMMANDS_ADMIN);
        String playerName = player.getGameProfile().name();
        UUID playerId = player.getUUID();
        return !accessPolicy.explicitlyDenies(playerName, playerId, "entityadmin")
                && (accessPolicy.hasCapability(playerName, playerId, AccessPolicy.ENTITY_INSPECT)
                || accessPolicy.hasCapability(playerName, playerId, AccessPolicy.ENTITY_EDIT));
    }

    private int sendEntityAdminHelp(CommandSourceStack source) {
        source.sendSuccess(() -> Component.literal(
                "Open Click Interval > Minecraft Server > Entity Viewer to inspect loaded entities and edit supported values."),
                false);
        return 1;
    }

    private int spectate(CommandSourceStack source, String playerName) {
        ServerPlayer viewer = source.getPlayer();
        ServerPlayer target = server == null ? null : server.getPlayerList().getPlayerByName(playerName);
        FabricSpectateController.Result result = playerViews.begin(viewer, target);
        if (result.success()) source.sendSuccess(() -> Component.literal(result.message()), false);
        else source.sendFailure(Component.literal(result.message()));
        return result.success() ? 1 : 0;
    }

    private boolean canViewPlayerInfo(CommandSourceStack source, String capability) {
        ServerPlayer player = source.getPlayer();
        return player == null
                ? source.permissions().hasPermission(Permissions.COMMANDS_ADMIN)
                : accessPolicy.hasCapability(player.getGameProfile().name(), player.getUUID(), capability);
    }

    private int sendPlayerInfo(CommandSourceStack source, String playerName, String action) {
        MinecraftServer currentServer = server;
        ServerPlayer target = currentServer == null ? null : currentServer.getPlayerList().getPlayerByName(playerName);
        if (target == null) {
            source.sendFailure(Component.literal("That player is not online."));
            return 0;
        }
        if (action.equals("dimension")) {
            String dimension = target.level().dimension().identifier().toString();
            source.sendSuccess(() -> Component.literal(target.getGameProfile().name()
                    + " is in " + dimension + "."), false);
            return 1;
        }
        source.sendSuccess(() -> Component.literal(target.getGameProfile().name()
                + ": X " + decimal(target.getX())
                + ", Y " + decimal(target.getY())
                + ", Z " + decimal(target.getZ())), false);
        return 1;
    }

    private int status(CommandSourceStack source) {
        ProtectionConfig current = config;
        int players = sessions.size();
        source.sendSuccess(() -> Component.literal("Server Protection: "
                + (current != null && current.enabled() ? "enabled" : "disabled")
                + ", " + SUPPORTED_CHECKS.length + " checks, " + players
                + " tracked session(s), " + playerViews.activeSessions()
                + " player view(s), TPS " + decimal(tickRate.tps())), false);
        return 1;
    }

    private int modStatus(CommandSourceStack source, String playerName) {
        MinecraftServer currentServer = server;
        ServerPlayer player = currentServer == null ? null : currentServer.getPlayerList().getPlayerByName(playerName);
        if (player == null) {
            source.sendFailure(Component.literal("That player is not online."));
            return 0;
        }
        ClientAttestationSessions.Snapshot snapshot = clientAttestation.status(player);
        String policyState = clientAttestation.policy().enabled() ? "policy enabled" : "policy disabled";
        String reporter = snapshot.reporterVersion().isBlank()
                ? "" : ", companion " + snapshot.reporterVersion();
        source.sendSuccess(() -> Component.literal(player.getGameProfile().name() + ": "
                + snapshot.description() + reporter + " (" + policyState
                + "). A report cannot prove that a client is clean."), false);
        return 1;
    }

    private int reload(CommandSourceStack source) {
        try {
            ProtectionConfig loaded = ProtectionConfig.load(configFile);
            config = loaded;
            reloadAccessPolicy();
            if (server != null) {
                for (ServerPlayer player : server.getPlayerList().getPlayers()) {
                    server.getCommands().sendCommands(player);
                }
            }
            playerViews.restoreUnauthorized(server);
            sessions.values().forEach(PlayerSession::resetEvidence);
            if (!FabricLoader.getInstance().isModLoaded("meowantixray")) {
                throw new IOException("packet Anti-Xray provider is missing");
            }
            var antiXrayReload = MeowAntiXrayMod.fakeOre().reloadConfigWithSummary();
            if (!antiXrayReload.applied()) {
                throw new IOException("packet Anti-Xray rejected its config and kept the last-known-good state");
            }
            boolean packetAntiXrayActive = reportPacketAntiXrayRuntime();
            if (loaded.hiddenOreDetection().enabled() && !packetAntiXrayActive) {
                throw new IOException("packet Anti-Xray did not activate after reload");
            }
            clientAttestation.load(configFile);
            if (server != null) {
                long now = System.currentTimeMillis();
                for (ServerPlayer player : server.getPlayerList().getPlayers()) {
                    clientAttestation.onJoin(player, now);
                }
            }
            source.sendSuccess(() -> Component.literal("Server Protection config reloaded."), false);
            return 1;
        } catch (IOException | RuntimeException | LinkageError error) {
            source.sendFailure(Component.literal("Server Protection reload failed: " + error.getMessage()));
            return 0;
        }
    }

    private int pardon(CommandSourceStack source, String playerName) {
        if (offenses == null) return 0;
        OffenseRecord record = offenses.findByName(playerName);
        if (record == null || !offenses.pardon(record.uuid())) {
            source.sendFailure(Component.literal("No protection record exists for " + playerName + "."));
            return 0;
        }
        violations.forgive(record.uuid());
        source.sendSuccess(() -> Component.literal("Pardoned protection record for " + record.name() + "."), false);
        queueStateSave();
        return 1;
    }

    private PlayerSession session(ServerPlayer player, long now, ProtectionConfig current) {
        PlayerSession existing = sessions.get(player.getUUID());
        if (existing != null) {
            existing.lastSeenAt = now;
            return existing;
        }
        PlayerSession created = new PlayerSession(
                now, now + secondsToMillis(current.grace().joinSeconds()), player.level());
        sessions.put(player.getUUID(), created);
        trimSessions();
        return created;
    }

    private void trimSessions() {
        while (sessions.size() > MAX_SESSIONS) {
            Iterator<UUID> iterator = sessions.keySet().iterator();
            if (!iterator.hasNext()) return;
            UUID removed = iterator.next();
            iterator.remove();
            violations.forgive(removed);
        }
    }

    private void pruneSessions(long now) {
        sessions.entrySet().removeIf(entry -> now - entry.getValue().lastSeenAt > SESSION_IDLE_MILLIS);
    }

    private void queueStateSave() {
        ExecutorService writer = stateWriter;
        OffenseStore store = offenses;
        if (writer == null || store == null || writer.isShutdown() || !saveQueued.compareAndSet(false, true)) return;
        writer.execute(() -> {
            try {
                store.saveIfDirty();
            } catch (IOException error) {
                LOGGER.warn("Could not save Server Protection state: {}", error.getMessage());
            } finally {
                saveQueued.set(false);
            }
        });
    }

    private static ReachCheckMath.Point point(Vec3 vector) {
        return new ReachCheckMath.Point(vector.x, vector.y, vector.z);
    }

    private static ReachCheckMath.Box reachBox(AABB box) {
        return new ReachCheckMath.Box(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ);
    }

    private static boolean isOnLiquidSurface(ServerPlayer player) {
        BlockPos below = BlockPos.containing(player.getX(), player.getY() - 0.08, player.getZ());
        return !player.level().getFluidState(below).isEmpty()
                && !player.isInWater() && !player.isInLava();
    }

    /** Covers flowing fluid and bubble-column contact even during boundary ticks where vanilla's
     * cached isInWater/isInLava flags have not caught up with the server-side bounding box yet. */
    private static boolean isFluidMovement(ServerPlayer player) {
        if (player.isInWater() || player.isInLava() || player.isSwimming()) return true;
        AABB body = player.getBoundingBox().inflate(0.001);
        for (BlockPos position : BlockPos.betweenClosed(body)) {
            if (!player.level().getFluidState(position).isEmpty()) return true;
        }
        return false;
    }

    /**
     * Ignores only collision shapes belonging to the exact wooden/copper door the player just
     * toggled. Any other colliding block, an unchanged door, an iron door, or an expired/remote
     * interaction remains phase evidence.
     */
    private static boolean collisionIsOnlyChangedDoor(ServerPlayer player,
                                                      DoorTransitionTracker transition,
                                                      long now,
                                                      AABB probe) {
        if (!transition.isActive(now, player.level())) return false;
        CollisionContext context = CollisionContext.of(player);
        boolean foundChangedDoorCollision = false;
        for (BlockPos position : expandedDoorCollisionPositions(probe)) {
            BlockState state = player.level().getBlockState(position);
            for (AABB localBox : state.getCollisionShape(player.level(), position, context).toAabbs()) {
                if (!probe.intersects(localBox.move(position))) continue;
                if (!(state.getBlock() instanceof DoorBlock door)
                        || !door.type().canOpenByHand()
                        || !transition.coversChangedDoor(now, player.level(),
                        position.getX(), canonicalDoorLowerY(state.getValue(DoorBlock.HALF), position.getY()),
                        position.getZ(), state.getValue(DoorBlock.OPEN))) {
                    return false;
                }
                foundChangedDoorCollision = true;
            }
        }
        return foundChangedDoorCollision;
    }

    static int canonicalDoorLowerY(DoubleBlockHalf half, int blockY) {
        return half == DoubleBlockHalf.UPPER ? blockY - 1 : blockY;
    }

    static Iterable<BlockPos> expandedDoorCollisionPositions(AABB probe) {
        return BlockPos.betweenClosed(probe.inflate(COLLISION_SCAN_MARGIN));
    }

    private static boolean isSpecialMovementSurface(ServerPlayer player) {
        String path = BuiltInRegistries.BLOCK.getKey(player.getBlockStateOn().getBlock()).getPath();
        return path.contains("ice") || path.contains("slime") || path.contains("honey")
                || path.contains("soul_sand") || path.contains("scaffolding");
    }

    private static double blockAimDeviation(ServerPlayer player, BlockPos position) {
        Vec3 eye = player.getEyePosition();
        Vec3 expected = new Vec3(position.getX() + 0.5 - eye.x,
                position.getY() + 0.5 - eye.y, position.getZ() + 0.5 - eye.z);
        Vec3 look = player.getLookAngle();
        double expectedLength = expected.length();
        double lookLength = look.length();
        if (expectedLength < 1.0e-9 || lookLength < 1.0e-9) return 0.0;
        double cosine = expected.dot(look) / (expectedLength * lookLength);
        return Math.toDegrees(Math.acos(Math.max(-1.0, Math.min(1.0, cosine))));
    }

    private static boolean invalidRotation(ServerPlayer player) {
        return !Float.isFinite(player.getXRot()) || !Float.isFinite(player.getYRot())
                || player.getXRot() < -90.0001f || player.getXRot() > 90.0001f;
    }

    /** Uses server collision state instead of the client-controlled on-ground packet bit. */
    private static boolean hasGroundSupport(ServerPlayer player) {
        return hasGroundSupport(player, BoatSupportProbe.find(player));
    }

    private static boolean hasGroundSupport(ServerPlayer player,
            net.minecraft.world.entity.vehicle.boat.AbstractBoat supportingBoat) {
        // Standing on a collidable entity is not the same as riding one. Use authoritative hull
        // contact even while the packet onGround bit/verticalCollisionBelow flicker during bobbing.
        if (supportingBoat != null) return true;
        boolean clientClaimedGround = player.onGround();
        if (player.verticalCollisionBelow) return true;
        // A false packet bit cannot grant an exemption, and avoids a collision query while airborne.
        // A true packet bit is only accepted after the bounded server-side support probe below.
        if (!clientClaimedGround) return false;
        AABB box = player.getBoundingBox();
        double epsilon = 1.0e-4;
        AABB support = new AABB(
                box.minX + epsilon, box.minY - 0.08, box.minZ + epsilon,
                box.maxX - epsilon, box.minY + 0.01, box.maxZ - epsilon);
        return resolveGroundSupport(clientClaimedGround, false,
                !player.level().noCollision(player, support));
    }

    static boolean resolveGroundSupport(boolean clientClaimedGround,
                                        boolean verticalCollisionBelow,
                                        boolean supportCollision) {
        return verticalCollisionBelow || (clientClaimedGround && supportCollision);
    }

    private static String decimal(double value) {
        return String.format(java.util.Locale.ROOT, "%.2f", value);
    }

    static long secondsToMillis(double seconds) {
        return Math.max(0L, Math.round(seconds * 1_000.0));
    }

    static boolean shouldCancelSpatialAttack(boolean responseEnabled, boolean reach, boolean wallHit) {
        return responseEnabled && (reach || wallHit);
    }

    private void reloadAccessPolicy() {
        try {
            accessPolicy.load(accessFile);
        } catch (IOException error) {
            LOGGER.warn("Server Protection rejected access.yml privileges: {}", error.getMessage());
        }
    }

    private boolean isProtectionExempt(ServerPlayer player) {
        if (player == null) return false;
        if (antiCheatExemptions.contains(player.getUUID())) return true;
        ProtectionConfig current = config;
        if (current == null) return false;
        String name = player.getGameProfile().name().toLowerCase(Locale.ROOT);
        String uuid = player.getUUID().toString().toLowerCase(Locale.ROOT);
        if (current.exemptions().players().contains(name)
                || current.exemptions().players().contains(uuid)) return true;
        if (accessPolicy.hasCapability(name, player.getUUID(), AccessPolicy.PROTECTION_BYPASS)) return true;
        AccessPolicy.Role role = accessPolicy.compatibilityRoleFor(name, player.getUUID());
        return (current.exemptions().owners() && role == AccessPolicy.Role.OWNER)
                || (current.exemptions().admins() && role == AccessPolicy.Role.ADMIN);
    }

    /** Called only by the bundled packet Anti-Xray mixin. Explicit command exemptions are exact. */
    public static boolean isPacketAntiXrayExempt(ServerPlayer player) {
        ServerProtectionFabric instance = active;
        return instance != null && player != null
                && instance.packetAntiXrayExemptions.shouldBypass(player.getUUID());
    }

    private boolean isCheckExempt(ServerPlayer player, Check check) {
        ProtectionConfig current = config;
        if (current == null || player == null || check == null) return false;
        if (isProtectionExempt(player)) return true;
        return current.checkExemptions().contains(
                check.id,
                player.getGameProfile().name(),
                player.getUUID().toString());
    }

    private boolean hasPlayerViewPrivilege(ServerPlayer player) {
        if (player == null) return false;
        String playerName = player.getGameProfile().name();
        UUID playerId = player.getUUID();
        return accessPolicy.hasCapability(playerName, playerId, AccessPolicy.PLAYER_SPECTATE);
    }

    private boolean canUseManagedCommand(ServerPlayer player, String command) {
        if (player == null) return false;
        return accessPolicy.commandDecision(player.getGameProfile().name(), player.getUUID(), command)
                == FabricAccessPolicy.CommandDecision.ELEVATE;
    }

    private int unspectate(CommandSourceStack source) {
        ServerPlayer player = source.getPlayer();
        if (player == null) {
            source.sendFailure(Component.literal("Only a player can use this command."));
            return 0;
        }
        FabricSpectateController.Result result = playerViews.restore(player);
        if (result.success()) source.sendSuccess(() -> Component.literal(result.message()), false);
        else source.sendFailure(Component.literal(result.message()));
        return result.success() ? 1 : 0;
    }

    private int startPlayerView(CommandSourceStack source, String viewerName, String targetName) {
        MinecraftServer currentServer = server;
        ServerPlayer viewer = currentServer == null ? null
                : currentServer.getPlayerList().getPlayerByName(viewerName);
        ServerPlayer target = currentServer == null ? null
                : currentServer.getPlayerList().getPlayerByName(targetName);
        if (viewer == null) {
            source.sendFailure(Component.literal("The viewing player is not online."));
            return 0;
        }
        FabricSpectateController.Result result = playerViews.begin(viewer, target);
        if (result.success()) {
            source.sendSuccess(() -> Component.literal(result.message()), false);
            viewer.sendSystemMessage(Component.literal(result.message()));
        } else {
            source.sendFailure(Component.literal(result.message()));
        }
        return result.success() ? 1 : 0;
    }

    private int stopPlayerView(CommandSourceStack source, String viewerName) {
        MinecraftServer currentServer = server;
        ServerPlayer viewer = currentServer == null ? null
                : currentServer.getPlayerList().getPlayerByName(viewerName);
        if (viewer == null) {
            source.sendFailure(Component.literal("The viewing player is not online."));
            return 0;
        }
        FabricSpectateController.Result result = playerViews.restore(viewer);
        if (result.success()) {
            source.sendSuccess(() -> Component.literal(result.message()), false);
            viewer.sendSystemMessage(Component.literal(result.message()));
        } else {
            source.sendFailure(Component.literal(result.message()));
        }
        return result.success() ? 1 : 0;
    }

    private static Component message(ProtectionMessages.StyledMessage template, Map<String, ?> values) {
        return FabricMessageComponent.parse(ProtectionMessages.render(template, values));
    }

    private static ProtectionConfig disabledConfig() {
        try {
            ProtectionConfig defaults = ProtectionConfig.parse("enabled: false");
            return defaults;
        } catch (IOException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private record ResolvedProtectionPlayer(UUID playerId, String name) {
        private String displayName() {
            return name == null || name.isBlank() ? playerId.toString() : name;
        }
    }

    private enum Check {
        SPEED("movement.speed", "movement"),
        FLIGHT("movement.flight", "movement"),
        PHASE("movement.phase", "movement"),
        INVALID_POSITION("movement.invalidPosition", "movement"),
        INVALID_ROTATION("movement.invalidRotation", "movement"),
        GROUND_SPOOF("movement.groundSpoof", "movement"),
        WATER_WALK("movement.waterWalk", "movement"),
        STEP("movement.step", "movement"),
        TIMER("movement.timer", "movement"),
        NO_SLOW("movement.noSlow", "movement"),
        REACH("combat.reach", "combat"),
        WALL_HIT("combat.wallHit", "combat"),
        AUTO_CLICKER("combat.autoClicker", "combat"),
        MULTI_TARGET("combat.multiTarget", "combat"),
        AIM_DIRECTION("combat.aimDirection", "combat"),
        KILL_AURA("combat.killAura", "combat"),
        CLICK_PATTERN("combat.clickPattern", "combat"),
        CRITICALS("combat.criticals", "combat"),
        FAST_BREAK("world.fastBreak", "world"),
        FAST_PLACE("world.fastPlace", "world"),
        BREAK_REACH("world.breakReach", "world"),
        PLACE_REACH("world.placeReach", "world"),
        SCAFFOLD("world.scaffold", "world"),
        MULTI_BREAK("world.multiBreak", "world"),
        CHAT_SPAM("abuse.chatSpam", "abuse"),
        COMMAND_SPAM("abuse.commandSpam", "abuse"),
        INVENTORY_SPAM("abuse.inventorySpam", "abuse"),
        HIDDEN_ORE("world.hiddenOre", "world");

        private final String id;
        private final String category;

        Check(String id, String category) {
            this.id = id;
            this.category = category;
        }
    }

    private static final class PlayerSession {
        private final MovementAnalyzer movement = new MovementAnalyzer();
        private final MovementTransitionTracker movementTransitions = new MovementTransitionTracker();
        private final BoatSupportTracker boatSupport = new BoatSupportTracker();
        private final DoorTransitionTracker doorTransition = new DoorTransitionTracker();
        private final CombatAnalyzer combat = new CombatAnalyzer();
        private final ActivityAnalyzer activity = new ActivityAnalyzer();
        private final InventoryActivityAnalyzer inventory = new InventoryActivityAnalyzer();
        private final HiddenOreAnalyzer hiddenOre = new HiddenOreAnalyzer();
        private final BehaviorPatternAnalyzer behavior = new BehaviorPatternAnalyzer();
        private final long[] lastDetectionAt = new long[Check.values().length];
        private long lastSeenAt;
        private long graceUntil;
        private long velocityGraceUntil;
        private long vehicleGraceUntil;
        private long lastPreWarningAt;
        private long lastInventoryResyncAt;
        private long rawBreakReachAt;
        private long rawPlaceReachAt;
        private int rawBreakReachEvidence;
        private int rawPlaceReachEvidence;
        private Object level;

        private PlayerSession(long now, long graceUntil, Object level) {
            this.lastSeenAt = now;
            this.graceUntil = graceUntil;
            this.level = level;
        }

        private boolean allowDetection(int checkIndex, long now) {
            long previous = lastDetectionAt[checkIndex];
            if (previous != 0L && now >= previous && now - previous < DETECTION_COOLDOWN_MILLIS) return false;
            lastDetectionAt[checkIndex] = now;
            return true;
        }

        private boolean allowInventoryResync(long now) {
            if (lastInventoryResyncAt != 0L && now >= lastInventoryResyncAt
                    && now - lastInventoryResyncAt < 500L) return false;
            lastInventoryResyncAt = now;
            return true;
        }

        private boolean confirmRawBlockReach(boolean placement, long now) {
            long previous = placement ? rawPlaceReachAt : rawBreakReachAt;
            int evidence = placement ? rawPlaceReachEvidence : rawBreakReachEvidence;
            evidence = previous > 0L && now >= previous && now - previous <= 1_250L ? evidence + 1 : 1;
            if (placement) {
                rawPlaceReachAt = now;
                rawPlaceReachEvidence = evidence;
            } else {
                rawBreakReachAt = now;
                rawBreakReachEvidence = evidence;
            }
            if (evidence < 2) return false;
            resetRawBlockReach(placement);
            return true;
        }

        private void resetRawBlockReach(boolean placement) {
            if (placement) {
                rawPlaceReachAt = 0L;
                rawPlaceReachEvidence = 0;
            } else {
                rawBreakReachAt = 0L;
                rawBreakReachEvidence = 0;
            }
        }

        private void resetEvidence() {
            movement.reset();
            doorTransition.reset();
            boatSupport.reset();
            combat.reset();
            activity.reset();
            inventory.reset();
            hiddenOre.reset();
            behavior.reset();
            resetRawBlockReach(false);
            resetRawBlockReach(true);
        }
    }
}
