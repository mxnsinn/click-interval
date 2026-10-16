package dev.serverteleport.fabric;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import dev.serverteleport.fabric.core.Clock;
import dev.serverteleport.fabric.core.ArrivalReadiness;
import dev.serverteleport.fabric.core.ChunkFootprint;
import dev.serverteleport.fabric.core.AcceptanceReservation;
import dev.serverteleport.fabric.core.DirectDestinationMatch;
import dev.serverteleport.fabric.core.DestinationLoads;
import dev.serverteleport.fabric.core.LoginSafetyState;
import dev.serverteleport.fabric.core.RequestBook;
import dev.serverteleport.fabric.core.RandomLandingSafety;
import dev.serverteleport.fabric.core.RandomTeleportArea;
import dev.serverteleport.fabric.core.UnexploredRegionCheck;
import dev.serverteleport.fabric.core.RequestOutcome;
import dev.serverteleport.fabric.core.ReturnLocationBook;
import dev.serverteleport.fabric.core.ReturnLockStore;
import dev.serverteleport.fabric.core.TeleportDimensionPolicy;
import dev.serverteleport.fabric.core.ReturnPoint;
import dev.serverteleport.fabric.core.SavedLocation;
import dev.serverteleport.fabric.core.SavedLocationStore;
import dev.serverteleport.fabric.core.ServerStoragePaths;
import dev.serverteleport.fabric.core.TeleportRequest;
import dev.serverteleport.fabric.core.TeleportWarmupState;
import dev.serverteleport.fabric.core.TravelGroupGraph;
import dev.serverteleport.fabric.core.TravelGroupTrigger;
import dev.serverteleport.fabric.core.TravelLandingOffsets;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientboundForgetLevelChunkPacket;
import net.minecraft.network.protocol.game.ClientboundLevelChunkWithLightPacket;
import net.minecraft.network.protocol.game.ClientboundRespawnPacket;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.TicketType;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.server.permissions.PermissionSet;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Leashable;
import net.minecraft.world.entity.OwnableEntity;
import net.minecraft.world.entity.TamableAnimal;
import net.minecraft.world.entity.projectile.FishingHook;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/** Logical-server Fabric adapter. Dedicated and integrated worlds use the same server-thread logic. */
public final class ServerTeleportFabric implements ModInitializer {
    public static final String MOD_ID = "serverteleport_fabric";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static volatile ServerTeleportFabric activeInstance;
    private static final int EXPIRY_TICK_INTERVAL = 20;
    private static final double NEARBY_PET_RANGE = 16.0;
    private static final double HOOKED_ENTITY_RANGE = 32.0;
    private static final int MAX_TRAVEL_ENTITIES = 32;
    private static final int MAX_RETURN_LOCATIONS = 4_096;
    private static final double COMPANION_SPACING = 2.0;
    private static final int COMPANION_SEARCH_RADIUS = 4;
    private static final long RECENT_PVP_MILLIS = 15_000L;
    private static final int MAX_COMBAT_ENTRIES = 4_096;
    private static final int DESTINATION_TICKET_RADIUS = 2;
    private static final int MAX_PREPARING_DESTINATIONS = 4;
    private static final int MAX_QUEUED_TELEPORTS = 32;
    private static final int MAX_DESTINATION_CHANGES = 4;
    private static final long PREPARATION_TIMEOUT_MILLIS = 30_000L;
    private static final int MAX_RANDOM_AREAS = 8;
    private static final int MAX_RANDOM_SEARCHES = 2;
    private static final int RANDOM_COLUMN_RADIUS = 4;

    private Path configFile;
    private MinecraftServer activeServer;
    private java.util.concurrent.ThreadPoolExecutor randomAreaReader;
    private final RequestBook requests = new RequestBook(Clock.SYSTEM, 60_000L, 10_000L, 8, 1_024);
    private final ReturnLocationBook returnLocations = new ReturnLocationBook(MAX_RETURN_LOCATIONS);
    private final LinkedHashMap<UUID, Long> recentPvpUntil = new LinkedHashMap<>();
    private final LinkedHashMap<UUID, PendingTeleport> pendingTeleports = new LinkedHashMap<>();
    private final LinkedHashMap<UUID, LoginGuard> loginGuards = new LinkedHashMap<>();
    private final Map<UUID, ArrivalGuard> arrivalGuards = new LinkedHashMap<>();
    private final Map<UUID, SentTerrain> sentTerrain = new LinkedHashMap<>();
    private final Map<ChunkTicketKey, Integer> preparationTickets = new LinkedHashMap<>();
    private TicketType preparationTicket;
    private final DestinationLoads<DestinationKey> destinationLoads = new DestinationLoads<>(
            MAX_PREPARING_DESTINATIONS, new DestinationLoads.Loader<>() {
                @Override
                public CompletableFuture<?> start(DestinationKey key) {
                    for (ChunkPos chunk : key.chunks()) preparationTickets.merge(
                            new ChunkTicketKey(key.level(), chunk), 1, Integer::sum);
                    return CompletableFuture.allOf(key.chunks().stream()
                            .map(chunk -> key.level().getChunkSource().addTicketAndLoadWithRadius(
                                    preparationTicket, chunk, 0))
                            .toArray(CompletableFuture[]::new));
                }

                @Override
                public boolean ready(DestinationKey key) {
                    return chunksReady(key);
                }

                @Override
                public void keepAlive(DestinationKey key) {
                    for (ChunkPos chunk : key.chunks()) key.level().getChunkSource().addTicketWithRadius(
                            preparationTicket, chunk, 0);
                }

                @Override
                public void release(DestinationKey key) {
                    for (ChunkPos chunk : key.chunks()) {
                        ChunkTicketKey ticket = new ChunkTicketKey(key.level(), chunk);
                        Integer references = preparationTickets.get(ticket);
                        if (references == null) continue;
                        if (references > 1) {
                            preparationTickets.put(ticket, references - 1);
                        } else {
                            preparationTickets.remove(ticket);
                            key.level().getChunkSource().removeTicketWithRadius(preparationTicket, chunk, 0);
                        }
                    }
                }
            });

    private TeleportConfig config = TeleportConfig.defaults();
    private SavedLocationStore locations;
    private ReturnLockStore returnLocks;
    private final Set<UUID> deathLockClearRetries = new LinkedHashSet<>();
    private int ticksUntilExpirySweep = EXPIRY_TICK_INTERVAL;
    private int arrivalsThisTick;
    private RandomNativeTest randomNativeTest;

    @Override
    public void onInitialize() {
        // Loading only: waiting for a TPA must not tick mobs/redstone at the destination.
        // This separate ticket also lets cancellation release our work without removing a
        // vanilla portal or login ticket. The timeout is a shutdown/error backstop.
        preparationTicket = Registry.register(BuiltInRegistries.TICKET_TYPE,
                Identifier.fromNamespaceAndPath(MOD_ID, "destination_preparation"),
                new TicketType(100L, TicketType.FLAG_LOADING));
        ServerLifecycleEvents.SERVER_STARTING.register(this::onServerStarting);
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            if (Boolean.getBoolean("serverteleport.randomSelftest")
                    && Files.isRegularFile(server.getWorldPath(LevelResource.ROOT)
                    .resolve("server-market-test-fixture"))) {
                randomNativeTest = new RandomNativeTest(server);
            }
        });
        ServerLifecycleEvents.SERVER_STOPPING.register(this::onServerStopping);
        ServerPlayConnectionEvents.JOIN.register((handler, sender, minecraftServer) ->
                beginLoginGuard(handler.getPlayer()));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, minecraftServer) ->
                onDisconnect(minecraftServer, handler.getPlayer()));
        ServerLivingEntityEvents.ALLOW_DAMAGE.register(this::allowDamage);
        ServerLivingEntityEvents.AFTER_DEATH.register((entity, source) -> {
            if (entity instanceof ServerPlayer player) onPlayerDeath(player);
        });
        ServerTickEvents.END_SERVER_TICK.register(this::onServerTick);
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {
            dispatcher.register(tpaCommand());
            dispatcher.register(Commands.literal("rtpa").executes(context -> teleportRandom(context.getSource())));
            // Keep the original aliases for existing players and integrations.
            dispatcher.register(responseCommand("tpaccept", true));
            dispatcher.register(responseCommand("tpdeny", false));
            dispatcher.register(cancelCommand());
            dispatcher.register(adminCommand());
        });
    }

    private void onServerStarting(MinecraftServer minecraftServer) {
        clearSessionState();
        activeServer = minecraftServer;
        activeInstance = this;
        randomAreaReader = new java.util.concurrent.ThreadPoolExecutor(1, 1, 0L,
                java.util.concurrent.TimeUnit.MILLISECONDS, new java.util.concurrent.ArrayBlockingQueue<>(4), task -> {
                    Thread thread = new Thread(task, "rtpa-region-check");
                    thread.setDaemon(true);
                    thread.setPriority(Thread.MIN_PRIORITY);
                    return thread;
                });
        Path worldRoot = minecraftServer.getWorldPath(LevelResource.ROOT);
        configFile = ServerStoragePaths.configFile(
                FabricLoader.getInstance().getConfigDir(), worldRoot, minecraftServer.isDedicatedServer());
        try {
            applyConfig(TeleportConfig.load(configFile));
            LOGGER.info("Server Teleport 1.8.1 loaded for Fabric 26.2 ({} server).",
                    minecraftServer.isDedicatedServer() ? "dedicated" : "integrated");
        } catch (IOException error) {
            applyConfig(TeleportConfig.defaults());
            LOGGER.error("Server Teleport could not load config.properties; safe defaults are active: {}",
                    error.getMessage());
        }
        Path locationsFile = ServerStoragePaths.locationsFile(worldRoot);
        try {
            locations = SavedLocationStore.open(locationsFile);
            LOGGER.info("Loaded persistent teleport places from {}.", locationsFile);
        } catch (IOException error) {
            locations = null;
            LOGGER.error("Persistent teleport places are unavailable; the existing file was not changed: {}",
                    error.getMessage());
        }
        try {
            returnLocks = ReturnLockStore.open(worldRoot.resolve("server-teleport").resolve("return-locks.tsv"));
        } catch (IOException error) {
            returnLocks = null;
            LOGGER.error("TPA disabled: return-lock storage could not be read; existing data preserved: {}", error.getMessage());
        }
    }

    private void clearSessionState() {
        if (randomAreaReader != null) randomAreaReader.shutdownNow();
        randomAreaReader = null;
        if (randomNativeTest != null) randomNativeTest.close();
        ticksUntilExpirySweep = EXPIRY_TICK_INTERVAL;
        requests.clear();
        returnLocations.clear();
        recentPvpUntil.clear();
        pendingTeleports.clear();
        destinationLoads.clear();
        // Normally destinationLoads releases every ticket. Also drop any partial-start leftovers.
        for (ChunkTicketKey key : preparationTickets.keySet()) {
            key.level().getChunkSource().removeTicketWithRadius(preparationTicket, key.chunk(), 0);
        }
        preparationTickets.clear();
        loginGuards.clear();
        clearArrivalGuards();
        sentTerrain.clear();
        arrivalsThisTick = 0;
        locations = null;
        returnLocks = null;
        deathLockClearRetries.clear();
    }

    private void onServerStopping(MinecraftServer minecraftServer) {
        if (minecraftServer != activeServer) return;
        activeInstance = null;
        clearSessionState();
        configFile = null;
        activeServer = null;
    }

    private void onServerTick(MinecraftServer minecraftServer) {
        processLoginGuards(minecraftServer);
        processArrivalGuards();
        processPendingTeleports(minecraftServer);
        if (randomNativeTest != null) randomNativeTest.tick();
        arrivalsThisTick = 0;
        if (--ticksUntilExpirySweep > 0) return;
        ticksUntilExpirySweep = EXPIRY_TICK_INTERVAL;
        long now = System.currentTimeMillis();
        for (UUID playerId : List.copyOf(deathLockClearRetries)) clearDeathReturnLock(playerId);
        recentPvpUntil.entrySet().removeIf(entry -> entry.getValue() <= now);
        for (TeleportRequest request : requests.expire()) {
            ServerPlayer requester = online(minecraftServer, request.requesterId());
            ServerPlayer target = online(minecraftServer, request.targetId());
            send(requester, "expired-requester", Map.of("target", request.targetName()));
            send(target, "expired-target", Map.of("requester", request.requesterName()));
        }
    }

    private void onDisconnect(MinecraftServer minecraftServer, ServerPlayer leaving) {
        UUID leavingId = leaving.getUUID();
        cancelPendingTeleport(leaving, "", false);
        loginGuards.remove(leavingId);
        finishArrival(leavingId);
        sentTerrain.remove(leavingId);
        // Keep the short combat marker until its normal expiry. Clearing it here would let a
        // player bypass the warmup by disconnecting and immediately rejoining.
        returnLocations.remove(leavingId);
        for (TeleportRequest request : requests.removePlayer(leavingId)) {
            if (request.requesterId().equals(leavingId)) {
                send(online(minecraftServer, request.targetId()), "requester-left-target",
                        Map.of("requester", request.requesterName()));
            } else {
                ServerPlayer requester = online(minecraftServer, request.requesterId());
                cancelPendingTeleport(requester, "", false);
                send(requester, "target-left-requester", Map.of("target", request.targetName()));
            }
        }
    }

    private boolean allowDamage(LivingEntity entity, DamageSource source, float amount) {
        if (!(entity instanceof ServerPlayer victim)) return true;
        ServerPlayer attacker = damagingPlayer(source);
        // Teams can cancel friendly damage in another listener. Do not mark a prevented hit
        // as PvP merely because this listener ran before theirs.
        if (attacker != null && TeamBridge.friendly(victim.getUUID(), attacker.getUUID())) return true;
        if (loginGuards.containsKey(victim.getUUID())) {
            // A joining player is held at their exact saved position until the chunk is ready.
            // Damage during that bounded hold can never be allowed to turn readiness lag into a death.
            return false;
        }

        // Delivery holds never swallow real damage or its knockback. Dangerous saved places
        // and combat remain dangerous; no invulnerability or post-arrival fall grace is added.
        finishArrival(victim.getUUID());

        cancelPendingTeleport(victim, "warmup-cancelled-damage", true);
        if (attacker != null && !attacker.getUUID().equals(victim.getUUID())) {
            finishArrival(attacker.getUUID());
            long now = System.currentTimeMillis();
            markRecentPvp(victim.getUUID(), now);
            markRecentPvp(attacker.getUUID(), now);
            // Attacking during a countdown is also unsafe; otherwise a player could begin the
            // warmup, keep fighting for ten seconds, and disappear immediately after a hit.
            cancelPendingTeleport(attacker, "warmup-cancelled-combat", true);
        }
        return true;
    }

    private void onPlayerDeath(ServerPlayer player) {
        // Death starts a new life, unlike a reconnect. It never removes saved places or /back.
        for (TeleportRequest request : resetPlayerLife(player.getUUID())) {
            UUID otherId = request.requesterId().equals(player.getUUID())
                    ? request.targetId() : request.requesterId();
            send(online(player.level().getServer(), otherId), "warmup-cancelled-unsafe", Map.of());
        }
    }

    /** Reset only death-scoped state; no cooldown or combat-tag exemption survives into the next fight. */
    List<TeleportRequest> resetPlayerLife(UUID playerId) {
        recentPvpUntil.remove(playerId);
        clearDeathReturnLock(playerId);
        List<TeleportRequest> removed = requests.removePlayerAfterDeath(playerId);
        cancelPendingTeleport(playerId);
        loginGuards.remove(playerId);
        finishArrival(playerId);
        sentTerrain.remove(playerId);
        // Accepted incoming requests are queued under their requester, not the deceased target.
        for (TeleportRequest request : removed) cancelPendingTeleport(request.requesterId());
        return removed;
    }

    private void clearDeathReturnLock(UUID playerId) {
        if (returnLocks == null) return;
        try {
            returnLocks.clearAfterDeath(playerId);
            deathLockClearRetries.remove(playerId);
        } catch (IOException error) {
            deathLockClearRetries.add(playerId);
            LOGGER.error("Could not persist death return-lock reset for {}: {}", playerId, error.getMessage());
        }
    }

    /** Optional team-ceasefire API; no compile-time dependency on the teams mod. */
    public static boolean isPvpTagged(UUID playerId) {
        ServerTeleportFabric instance = activeInstance;
        return instance != null && playerId != null
                && instance.recentPvpUntil.getOrDefault(playerId, 0L) > System.currentTimeMillis();
    }

    private static ServerPlayer damagingPlayer(DamageSource source) {
        if (source == null) return null;
        // DamageSource#getEntity is the responsible attacker for direct hits and player-fired
        // projectiles. Do not attribute autonomous attacks by a player's tame animals to that
        // owner: only actual player-versus-player combat activates the teleport warmup.
        if (source.getEntity() instanceof ServerPlayer player) return player;
        if (source.getDirectEntity() instanceof ServerPlayer player) return player;
        return null;
    }

    private void markRecentPvp(UUID playerId, long nowMillis) {
        if (playerId == null) return;
        recentPvpUntil.remove(playerId);
        recentPvpUntil.put(playerId, safeAdd(nowMillis, RECENT_PVP_MILLIS));
        while (recentPvpUntil.size() > MAX_COMBAT_ENTRIES) {
            Iterator<UUID> oldest = recentPvpUntil.keySet().iterator();
            if (!oldest.hasNext()) break;
            oldest.next();
            oldest.remove();
        }
    }

    private boolean inRecentPvp(ServerPlayer player, long nowMillis) {
        return recentPvpUntil.getOrDefault(player.getUUID(), 0L) > nowMillis;
    }

    private void beginLoginGuard(ServerPlayer player) {
        if (player == null || player.hasDisconnected() || !validPosition(
                player.getX(), player.getY(), player.getZ())) return;
        ServerLevel level = player.level();
        ChunkPos chunk = ChunkPos.containing(player.blockPosition());
        CompletableFuture<?> loadFuture;
        try {
            loadFuture = level.getChunkSource().addTicketAndLoadWithRadius(
                    TicketType.PORTAL, chunk, DESTINATION_TICKET_RADIUS);
        } catch (RuntimeException error) {
            loadFuture = CompletableFuture.failedFuture(error);
            LOGGER.error("Could not request the login chunk {} for {}: {}",
                    chunk, player.getGameProfile().name(), error.getMessage());
        }
        player.setDeltaMovement(Vec3.ZERO);
        player.resetFallDistance();
        loginGuards.put(player.getUUID(), new LoginGuard(
                level,
                chunk,
                loadFuture,
                new LoginSafetyState(
                        System.currentTimeMillis(),
                        dimensionName(level),
                        player.getX(), player.getY(), player.getZ(),
                        player.getYRot(), player.getXRot())));
    }

    private void processLoginGuards(MinecraftServer minecraftServer) {
        Iterator<Map.Entry<UUID, LoginGuard>> iterator = loginGuards.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<UUID, LoginGuard> entry = iterator.next();
            ServerPlayer player = online(minecraftServer, entry.getKey());
            if (player == null) {
                iterator.remove();
                continue;
            }
            LoginGuard guard = entry.getValue();
            boolean chunkReady = player.level() == guard.level()
                    && guard.loadFuture().isDone()
                    && !guard.loadFuture().isCompletedExceptionally()
                    && guard.level().getChunkSource().getChunkNow(
                    guard.chunk().x(), guard.chunk().z()) != null;
            LoginSafetyState.Status status = guard.state().update(
                    System.currentTimeMillis(), dimensionName(player.level()), chunkReady);
            if (status != LoginSafetyState.Status.DIMENSION_CHANGED) {
                holdLoginPosition(player, guard.state());
            }
            switch (status) {
                case HOLD -> {
                }
                case RELEASE, DIMENSION_CHANGED -> iterator.remove();
                case TIMED_OUT -> {
                    iterator.remove();
                    LOGGER.error("Login chunk {} did not become ready for {} within {} seconds; disconnecting at the preserved position.",
                            guard.chunk(), player.getGameProfile().name(),
                            LoginSafetyState.TIMEOUT_MILLIS / 1_000L);
                    player.connection.disconnect(Component.literal(
                            "Your login area could not be loaded safely. Your position was preserved; please reconnect."));
                }
            }
        }
    }

    private static void holdLoginPosition(ServerPlayer player, LoginSafetyState state) {
        double dx = player.getX() - state.x();
        double dy = player.getY() - state.y();
        double dz = player.getZ() - state.z();
        if (dx * dx + dy * dy + dz * dz > 1.0E-8) {
            player.connection.teleport(
                    state.x(), state.y(), state.z(), state.yaw(), state.pitch());
        } else {
            player.setPos(state.x(), state.y(), state.z());
        }
        player.setDeltaMovement(Vec3.ZERO);
        player.resetFallDistance();
    }

    public static boolean isAwaitingArrival(ServerPlayer player) {
        if (!isActivePlayer(player)) return false;
        ArrivalGuard guard = activeInstance.arrivalGuards.get(player.getUUID());
        return guard != null && guard.player() == player;
    }

    private static boolean isActivePlayer(ServerPlayer player) {
        return activeInstance != null && player != null
                && player.level().getServer() == activeInstance.activeServer;
    }

    public static void onArrivalPositionAccepted(ServerPlayer player) {
        if (!isActivePlayer(player)) return;
        ArrivalGuard guard = activeInstance.arrivalGuards.get(player.getUUID());
        if (guard != null && guard.player() == player && guard.state().acknowledge(true)) {
            activeInstance.finishArrival(player.getUUID());
        }
    }

    /** Called on the server thread, after successful chunk write or immediately for invalidation. */
    public static void onOutgoingTerrainPacket(ServerGamePacketListenerImpl connection, Packet<?> packet,
                                               ServerLevel expectedLevel) {
        if (activeInstance == null || !(packet instanceof ClientboundLevelChunkWithLightPacket
                || packet instanceof ClientboundForgetLevelChunkPacket || packet instanceof ClientboundRespawnPacket)) {
            return;
        }
        ServerPlayer player = connection.player;
        if (!isActivePlayer(player) || player.hasDisconnected() || player.level() != expectedLevel) return;
        UUID id = player.getUUID();
        if (packet instanceof ClientboundRespawnPacket) {
            activeInstance.sentTerrain.remove(id);
            return;
        }
        SentTerrain terrain = activeInstance.sentTerrain.get(id);
        if (packet instanceof ClientboundLevelChunkWithLightPacket chunk) {
            if (terrain == null || terrain.level() != player.level()) {
                terrain = new SentTerrain(player.level(), new LinkedHashSet<>());
                activeInstance.sentTerrain.put(id, terrain);
            }
            terrain.chunks().add(ChunkPos.pack(chunk.getX(), chunk.getZ()));
            // Vanilla's largest normal view is smaller; the cap contains unusual mod sends.
            while (terrain.chunks().size() > 8_192) terrain.chunks().removeFirst();
        } else if (terrain != null && packet instanceof ClientboundForgetLevelChunkPacket forgotten) {
            terrain.chunks().remove(forgotten.pos().pack());
        }
    }

    private static boolean footprintSent(ServerPlayer player, List<ChunkPos> chunks) {
        SentTerrain terrain = !isActivePlayer(player) ? null : activeInstance.sentTerrain.get(player.getUUID());
        if (terrain == null || terrain.level() != player.level()) return false;
        for (ChunkPos chunk : chunks) {
            if (player.level().getChunkSource().getChunkNow(chunk.x(), chunk.z()) == null
                    || !terrain.chunks().contains(chunk.pack())) {
                return false;
            }
        }
        return true;
    }

    private void beginArrival(ServerPlayer player, List<ChunkPos> chunks) {
        finishArrival(player.getUUID());
        Entity root = player.getRootVehicle();
        boolean oldNoGravity = root.isNoGravity();
        root.setNoGravity(true);
        root.setDeltaMovement(Vec3.ZERO);
        player.setDeltaMovement(Vec3.ZERO);
        arrivalGuards.put(player.getUUID(), new ArrivalGuard(player, player.level(), player.position(),
                root, root.position(), oldNoGravity, chunks, new ArrivalReadiness(System.currentTimeMillis())));
        // Establish the destination view immediately; vanilla sends nearest chunks using
        // its existing client-acknowledged batch budget on its normal tick.
        player.level().getChunkSource().move(player);
        // Use vanilla's budget and packet path, including Anti-Xray rewriting. No raw
        // un-obfuscated chunk packets and no far cache-center preflight at the origin.
        player.connection.chunkSender.sendNextChunks(player);
    }

    private void finishArrival(UUID playerId) {
        ArrivalGuard guard = arrivalGuards.remove(playerId);
        if (guard != null && !guard.root().isRemoved()) {
            guard.root().setNoGravity(guard.rootNoGravity());
        }
    }

    private void clearArrivalGuards() {
        for (UUID playerId : List.copyOf(arrivalGuards.keySet())) finishArrival(playerId);
    }

    private void processArrivalGuards() {
        for (ArrivalGuard guard : List.copyOf(arrivalGuards.values())) {
            ServerPlayer player = guard.player();
            if (player.hasDisconnected() || !player.isAlive() || player.level() != guard.level()
                    || player.getRootVehicle() != guard.root()
                    || player.position().distanceToSqr(guard.position()) > 4.0) {
                finishArrival(player.getUUID());
                continue;
            }
            ArrivalReadiness.Step step = guard.state().poll(
                    System.currentTimeMillis(), footprintSent(player, guard.chunks()));
            switch (step) {
                case SEND_POSITION_BARRIER -> {
                    // TCP preserves order: the client receives the landing chunk/light data
                    // before this position. Its matching ACK then releases movement at once.
                    guard.state().barrierSent();
                    player.connection.teleport(player.getX(), player.getY(), player.getZ(),
                            player.getYRot(), player.getXRot());
                }
                case TIMED_OUT -> {
                    finishArrival(player.getUUID());
                    player.connection.disconnect(Component.literal(
                            "The teleport area could not be delivered in time. Please reconnect."));
                }
                case COMPLETE -> finishArrival(player.getUUID());
                case WAIT_FOR_CHUNKS, WAIT_FOR_ACK -> {
                    guard.root().setPos(guard.rootPosition());
                    guard.root().setDeltaMovement(Vec3.ZERO);
                    guard.root().resetFallDistance();
                    player.resetFallDistance();
                }
            }
        }
    }

    private void processPendingTeleports(MinecraftServer minecraftServer) {
        long now = System.currentTimeMillis();
        boolean startedLoadThisTick = false;
        boolean searchedRandomAreaThisTick = false;
        Iterator<Map.Entry<UUID, PendingTeleport>> iterator = pendingTeleports.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<UUID, PendingTeleport> entry = iterator.next();
            ServerPlayer player = online(minecraftServer, entry.getKey());
            PendingTeleport pending = entry.getValue();
            if (player == null) {
                iterator.remove();
                releaseDestination(pending);
                pending.cancelWarmup().run();
                continue;
            }
            boolean warmupComplete = pending.state() == null;
            boolean unsafe = player != pending.player || !player.isAlive() || player.isRemoved()
                    || !pending.originDimension.equals(dimensionName(player.level()));
            if (pending.state() != null) {
                // Keep checking after the ten-second deadline while terrain is loading. A
                // completed countdown must not allow movement/damage to bypass cancellation.
                TeleportWarmupState.Update update = pending.state().update(
                        now, dimensionName(player.level()),
                        player.getX(), player.getY(), player.getZ(), !unsafe);
                switch (update.status()) {
                    case COUNTDOWN -> send(player, "warmup-countdown",
                            Map.of("seconds", update.secondsRemaining()));
                    case MOVED -> {
                        iterator.remove();
                        releaseDestination(pending);
                        pending.cancelWarmup().run();
                        send(player, "warmup-cancelled-moved", Map.of());
                        continue;
                    }
                    case UNSAFE -> unsafe = true;
                    case COMPLETE -> warmupComplete = true;
                    case WAITING -> { }
                }
            }
            if (unsafe) {
                iterator.remove();
                releaseDestination(pending);
                pending.cancelWarmup().run();
                send(player, "warmup-cancelled-unsafe", Map.of());
                continue;
            }
            if (now >= pending.deadlineMillis) {
                iterator.remove();
                releaseDestination(pending);
                pending.releaseAfterFailure().run();
                send(player, "destination-chunk-unavailable", Map.of());
                continue;
            }

            try {
                if (pending.random != null && !pending.random.approved) {
                    if (!pending.random.freshness.isDone()) continue;
                    if (!pending.random.freshness.getNow(false) || pending.random.nearLoadedArea()) {
                        if (!pending.random.nextArea(player)) {
                            iterator.remove();
                            releaseDestination(pending);
                            pending.releaseAfterFailure().run();
                            send(player, "random-no-safe-destination", Map.of());
                        }
                        continue;
                    }
                    pending.random.approved = true;
                }
                DestinationKey destination = pending.destination.get();
                if (destination == null) {
                    iterator.remove();
                    releaseDestination(pending);
                    pending.releaseAfterFailure().run();
                    send(player, "player-unavailable", Map.of());
                    continue;
                }
                if (pending.load != null && !pending.load.key().equals(destination)) {
                    // Follow a moving target only within the same bounded timeout. Release
                    // the former destination before requesting another one.
                    releaseDestination(pending);
                    if (++pending.destinationChanges > MAX_DESTINATION_CHANGES) {
                        iterator.remove();
                        pending.releaseAfterFailure().run();
                        send(player, "destination-moving", Map.of());
                        continue;
                    }
                }
                boolean alreadyLoaded = chunksReady(destination);
                if (alreadyLoaded && pending.load != null) destinationLoads.poll(pending.load);
                if (!alreadyLoaded && pending.load == null && !startedLoadThisTick) {
                    pending.load = destinationLoads.acquire(destination);
                    if (pending.load != null) startedLoadThisTick = true;
                }
                DestinationLoads.Status status = alreadyLoaded ? DestinationLoads.Status.READY : pending.load == null
                        ? DestinationLoads.Status.WAITING : destinationLoads.poll(pending.load);
                if (status == DestinationLoads.Status.READY && pending.random != null
                        && pending.random.landing == null) {
                    if (searchedRandomAreaThisTick) continue;
                    searchedRandomAreaThisTick = true;
                    if (!pending.random.findSurface(player)) {
                        releaseDestination(pending);
                        if (!pending.random.nextArea(player)) {
                            iterator.remove();
                            pending.releaseAfterFailure().run();
                            send(player, "random-no-safe-destination", Map.of());
                        }
                        continue;
                    }
                }
                if (status == DestinationLoads.Status.FAILED) {
                    iterator.remove();
                    releaseDestination(pending);
                    pending.releaseAfterFailure().run();
                    send(player, "destination-chunk-unavailable", Map.of());
                } else if (status == DestinationLoads.Status.READY && warmupComplete && arrivalsThisTick == 0) {
                    // Limit new arrival/packet bursts to one travel group per tick. The
                    // vanilla client-acknowledged chunk sender handles the remaining view.
                    iterator.remove();
                    arrivalsThisTick++;
                    boolean completed;
                    try {
                        completed = pending.action().execute();
                    } finally {
                        releaseDestination(pending);
                    }
                    if (!completed) pending.releaseAfterFailure().run();
                } else if (warmupComplete && !pending.loadingAnnounced
                        && now >= pending.deadlineMillis - PREPARATION_TIMEOUT_MILLIS + 1_000L) {
                    pending.loadingAnnounced = true;
                    send(player, "destination-loading", Map.of());
                }
            } catch (RuntimeException error) {
                // The iterator may already have removed a ready teleport before its action
                // failed. Remove by key only in the still-pending case.
                if (pendingTeleports.containsKey(entry.getKey())) iterator.remove();
                releaseDestination(pending);
                pending.releaseAfterFailure().run();
                LOGGER.error("A prepared TPA failed for {}: {}",
                        player.getGameProfile().name(), error.getMessage(), error);
                send(player, "teleport-failed", Map.of());
            }
        }
    }

    private void releaseDestination(PendingTeleport pending) {
        destinationLoads.release(pending.load);
        pending.load = null;
    }

    private boolean cancelPendingTeleport(ServerPlayer player, String messageKey, boolean notify) {
        if (player == null) return false;
        if (!cancelPendingTeleport(player.getUUID())) return false;
        if (notify && messageKey != null && !messageKey.isBlank()) {
            send(player, messageKey, Map.of());
        }
        return true;
    }

    private boolean cancelPendingTeleport(UUID playerId) {
        PendingTeleport pending = pendingTeleports.remove(playerId);
        if (pending == null) return false;
        releaseDestination(pending);
        pending.cancelWarmup().run();
        return true;
    }

    private Dispatch dispatchTeleport(
            ServerPlayer player,
            Supplier<DestinationKey> destination,
            TeleportAction action,
            Runnable cancellation,
            Runnable failure) {
        return dispatchTeleport(player, destination, action, cancellation, failure, null);
    }

    private Dispatch dispatchTeleport(
            ServerPlayer player,
            Supplier<DestinationKey> destination,
            TeleportAction action,
            Runnable cancellation,
            Runnable failure,
            RandomDestination random) {
        if (pendingTeleports.containsKey(player.getUUID()) || arrivalGuards.containsKey(player.getUUID())) {
            send(player, "warmup-already-running", Map.of());
            return Dispatch.REJECTED;
        }
        if (pendingTeleports.size() >= MAX_QUEUED_TELEPORTS) {
            send(player, "destination-busy", Map.of());
            return Dispatch.REJECTED;
        }
        long now = System.currentTimeMillis();
        if (random == null && !inRecentPvp(player, now) && arrivalsThisTick == 0) {
            DestinationKey ready = destination.get();
            if (ready != null && chunksReady(ready)) {
                arrivalsThisTick++;
                return action.execute() ? Dispatch.COMPLETED : Dispatch.FAILED;
            }
        }
        TeleportWarmupState state = inRecentPvp(player, now) ? new TeleportWarmupState(
                now,
                dimensionName(player.level()),
                player.getX(), player.getY(), player.getZ()) : null;
        pendingTeleports.put(player.getUUID(), new PendingTeleport(
                player, state, dimensionName(player.level()), safeAdd(now, PREPARATION_TIMEOUT_MILLIS),
                destination, action, cancellation, failure, random));
        if (state != null) send(player, "warmup-countdown", Map.of("seconds", 10));
        return Dispatch.SCHEDULED;
    }

    private static DestinationKey destinationKey(ServerLevel level, SavedLocation location, ServerPlayer traveler) {
        // At least a 3x3 chunk neighborhood, never an entire view distance. This contains
        // actual collision terrain around arrival and the bounded random/companion scan.
        return new DestinationKey(level, chunksForBounds(destinationBounds(location, traveler).inflate(16, 0, 16)));
    }

    private static AABB destinationBounds(SavedLocation location, ServerPlayer traveler) {
        double dx = location.x() - traveler.getX();
        double dy = location.y() - traveler.getY();
        double dz = location.z() - traveler.getZ();
        AABB bounds = traveler.getBoundingBox().move(dx, dy, dz);
        for (Entity member : traveler.getRootVehicle().getSelfAndPassengers().toList()) {
            bounds = bounds.minmax(member.getBoundingBox().move(dx, dy, dz));
        }
        boolean companions = !Leashable.leashableLeashedTo(traveler).isEmpty()
                || traveler.fishing != null && traveler.fishing.getHookedIn() != null
                || !traveler.level().getEntities(traveler, traveler.getBoundingBox().inflate(NEARBY_PET_RANGE),
                candidate -> isTravelingPet(candidate, traveler)).isEmpty();
        if (companions) bounds = bounds.inflate(10.0, 0.0, 10.0);
        return bounds;
    }

    private static DestinationKey playerDestinationKey(MinecraftServer server, UUID playerId, ServerPlayer traveler) {
        ServerPlayer player = online(server, playerId);
        if (player == null || !player.isAlive() || !validPosition(
                player.getX(), player.getY(), player.getZ())) return null;
        return destinationKey(player.level(), locationOf(player), traveler);
    }

    private static List<ChunkPos> chunksForBounds(AABB bounds) {
        ChunkFootprint footprint = ChunkFootprint.ofBounds(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ);
        ArrayList<ChunkPos> chunks = new ArrayList<>();
        for (int x = footprint.minX(); x <= footprint.maxX(); x++) {
            for (int z = footprint.minZ(); z <= footprint.maxZ(); z++) chunks.add(new ChunkPos(x, z));
        }
        return List.copyOf(chunks);
    }

    private static boolean chunksReady(DestinationKey key) {
        for (ChunkPos chunk : key.chunks()) {
            if (key.level().getChunkSource().getChunkNow(chunk.x(), chunk.z()) == null) return false;
        }
        return true;
    }

    private static String dimensionName(ServerLevel level) {
        return level.dimension().identifier().toString();
    }

    private static long safeAdd(long left, long right) {
        try {
            return Math.addExact(left, right);
        } catch (ArithmeticException overflow) {
            return Long.MAX_VALUE;
        }
    }

    private LiteralArgumentBuilder<CommandSourceStack> tpaCommand() {
        return Commands.literal("tpa")
                .executes(context -> usage(context.getSource(), "usage-tpa"))
                .then(responseCommand("accept", true))
                .then(responseCommand("decline", false))
                .then(Commands.literal("set")
                        .executes(context -> usage(context.getSource(), "usage-tpa-set"))
                        .then(Commands.argument("name", StringArgumentType.greedyString())
                                .executes(context -> saveLocation(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "name")))))
                .then(Commands.literal("list")
                        .executes(context -> listLocations(context.getSource())))
                .then(Commands.literal("back")
                        .executes(context -> teleportBack(context.getSource())))
                .then(Commands.literal("go")
                        .executes(context -> usage(context.getSource(), "usage-tpa-go"))
                        .then(Commands.argument("name", StringArgumentType.greedyString())
                                .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                        savedLocationNames(context.getSource()), builder))
                                .executes(context -> {
                                    ServerPlayer owner = player(context.getSource());
                                    return owner == null ? 0 : teleportToSavedLocation(
                                            context.getSource(),
                                            owner,
                                            StringArgumentType.getString(context, "name"));
                                })))
                .then(Commands.literal("player")
                        .executes(context -> usage(context.getSource(), "usage-tpa-player"))
                        .then(Commands.argument("username", StringArgumentType.word())
                                .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                        onlinePlayerNames(context.getSource()), builder))
                                .executes(context -> requestPlayer(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "username")))))
                .then(Commands.literal("delete")
                        .executes(context -> usage(context.getSource(), "usage-tpa-delete"))
                        .then(Commands.argument("name", StringArgumentType.greedyString())
                                .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                        savedLocationNames(context.getSource()), builder))
                                .executes(context -> deleteLocation(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "name")))))
                .then(Commands.argument("destination", StringArgumentType.greedyString())
                        .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                tpaRootSuggestions(context.getSource()), builder))
                        .executes(context -> resolveDirectDestination(
                                context.getSource(),
                                StringArgumentType.getString(context, "destination"))));
    }

    private LiteralArgumentBuilder<CommandSourceStack> responseCommand(String name, boolean accept) {
        return Commands.literal(name)
                .executes(context -> respond(context.getSource(), "", accept))
                .then(Commands.argument("player", StringArgumentType.word())
                        .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                incomingRequesters(context.getSource()), builder))
                        .executes(context -> respond(context.getSource(),
                                StringArgumentType.getString(context, "player"), accept)));
    }

    private LiteralArgumentBuilder<CommandSourceStack> cancelCommand() {
        return Commands.literal("tpacancel")
                .executes(context -> cancel(context.getSource()));
    }

    private LiteralArgumentBuilder<CommandSourceStack> adminCommand() {
        return Commands.literal("serverteleport")
                .requires(source -> source.permissions().hasPermission(Permissions.COMMANDS_ADMIN))
                .executes(context -> usage(context.getSource(), "usage-admin"))
                .then(Commands.literal("reload").executes(context -> reload(context.getSource())));
    }

    private int requestPlayer(CommandSourceStack source, String playerName) {
        ServerPlayer requester = player(source);
        if (requester == null) return 0;
        ServerPlayer target = findOnlineByName(source.getServer(), cleanDestinationName(playerName));
        if (target == null) return fail(requester, "player-unavailable", Map.of());
        return createRequest(source, requester, target);
    }

    /**
     * Resolves the shorthand namespace without fuzzy matching or unsafe fallthrough.
     * Saved places and online players are looked up independently and must match the complete
     * supplied name. An exact collision is rejected so the player must choose an explicit route.
     */
    private int resolveDirectDestination(CommandSourceStack source, String requestedName) {
        ServerPlayer requester = player(source);
        if (requester == null) return 0;
        SavedLocationStore store = locations;
        if (store == null) return fail(requester, "location-storage-failed", Map.of());

        String displayName = cleanDestinationName(requestedName);
        String savedName = SavedLocationStore.normalizeName(displayName);
        Optional<SavedLocation> savedLocation = store.find(requester.getUUID(), savedName);
        ServerPlayer target = findOnlineByName(source.getServer(), displayName);

        return switch (DirectDestinationMatch.resolve(savedLocation.isPresent(), target != null)) {
            case SAVED_PLACE -> teleportToSavedLocation(source, requester, savedName);
            case ONLINE_PLAYER -> createRequest(source, requester, target);
            case AMBIGUOUS -> fail(requester, "destination-ambiguous", Map.of(
                    "name", savedName,
                    "player", target.getGameProfile().name()));
            case NOT_FOUND -> fail(requester, "destination-unavailable", Map.of(
                    "name", displayName));
        };
    }

    private int createRequest(CommandSourceStack source, ServerPlayer requester, ServerPlayer target) {
        if (!travelAllowed(requester, target.level(), locationOf(target))) {
            send(target, "request-failed-target", Map.of("requester", requester.getGameProfile().name()));
            return 0;
        }
        RequestOutcome outcome = requests.create(
                requester.getUUID(),
                requester.getGameProfile().name(),
                target.getUUID(),
                target.getGameProfile().name(),
                source.permissions().hasPermission(Permissions.COMMANDS_ADMIN));
        return switch (outcome.status()) {
            case CREATED -> {
                send(requester, "request-sent", Map.of("target", target.getGameProfile().name()));
                if (TeamBridge.trusts(target.getUUID(), requester.getUUID())) {
                    send(target, "trusted-auto-accept", Map.of("requester", requester.getGameProfile().name()));
                    yield respond(target.createCommandSourceStack(), requester.getGameProfile().name(), true);
                }
                sendRequestPrompt(target, requester.getGameProfile().name());
                yield 1;
            }
            case SELF_TARGET -> fail(requester, "cannot-target-self", Map.of());
            case OUTGOING_EXISTS -> fail(requester, "already-pending",
                    Map.of("target", outcome.request().targetName()));
            case TARGET_LIMIT -> fail(requester, "target-limit", Map.of());
            case SERVER_LIMIT -> fail(requester, "server-limit", Map.of());
            case COOLDOWN -> fail(requester, "cooldown",
                    Map.of("seconds", ceilSeconds(outcome.retryAfterMillis())));
            default -> 0;
        };
    }

    private int saveLocation(CommandSourceStack source, String requestedName) {
        ServerPlayer owner = player(source);
        if (owner == null) return 0;
        String name = SavedLocationStore.normalizeName(requestedName);
        if (name.isEmpty()) {
            send(owner, "location-invalid-name-v2", Map.of(
                    "max", SavedLocationStore.MAX_NAME_LENGTH));
            return 0;
        }
        SavedLocationStore store = locations;
        if (store == null) return fail(owner, "location-storage-failed", Map.of());

        final SavedLocation location;
        try {
            location = new SavedLocation(
                    owner.level().dimension().identifier().toString(),
                    owner.getX(),
                    owner.getY(),
                    owner.getZ(),
                    owner.getYRot(),
                    owner.getXRot());
        } catch (IllegalArgumentException error) {
            return fail(owner, "location-unsafe", Map.of("name", name));
        }

        try {
            SavedLocationStore.PutResult result = store.put(owner.getUUID(), name, location);
            if (result == SavedLocationStore.PutResult.LIMIT_REACHED) {
                return fail(owner, "location-limit", Map.of(
                        "max", SavedLocationStore.MAX_LOCATIONS_PER_PLAYER));
            }
            send(owner, "location-saved-go", Map.of("name", name));
            return 1;
        } catch (IOException error) {
            LOGGER.error("Could not atomically save a teleport place for {}: {}",
                    owner.getUUID(), error.getMessage());
            return fail(owner, "location-storage-failed", Map.of());
        }
    }

    private int listLocations(CommandSourceStack source) {
        ServerPlayer owner = player(source);
        if (owner == null) return 0;
        SavedLocationStore store = locations;
        if (store == null) return fail(owner, "location-storage-failed", Map.of());
        List<String> names = store.names(owner.getUUID());
        if (names.isEmpty()) return fail(owner, "location-none", Map.of());
        // Thirty maximum-length names exceed the bounded chat template; split without truncation.
        for (int start = 0; start < names.size(); start += 10) {
            send(owner, "location-list", Map.of("locations", String.join(", ", names.subList(start, Math.min(start + 10, names.size())))));
        }
        return names.size();
    }

    private int deleteLocation(CommandSourceStack source, String requestedName) {
        ServerPlayer owner = player(source);
        if (owner == null) return 0;
        String name = SavedLocationStore.normalizeName(requestedName);
        if (name.isEmpty()) {
            return fail(owner, "location-invalid-name-v2", Map.of(
                    "max", SavedLocationStore.MAX_NAME_LENGTH));
        }
        SavedLocationStore store = locations;
        if (store == null) return fail(owner, "location-storage-failed", Map.of());
        try {
            if (!store.delete(owner.getUUID(), name)) {
                return fail(owner, "location-not-found", Map.of("name", name));
            }
            send(owner, "location-deleted", Map.of("name", name));
            return 1;
        } catch (IOException error) {
            LOGGER.error("Could not atomically delete a teleport place for {}: {}",
                    owner.getUUID(), error.getMessage());
            return fail(owner, "location-storage-failed", Map.of());
        }
    }

    private int teleportRandom(CommandSourceStack source) {
        ServerPlayer owner = player(source);
        if (owner == null) return 0;
        ServerLevel destination = owner.level();
        if (!dimensionAllowed(owner, destination)) return 0;
        boolean bypassCooldown = source.permissions().hasPermission(Permissions.COMMANDS_ADMIN);
        long remaining = requests.remainingCooldownMillis(owner.getUUID(), bypassCooldown);
        if (remaining > 0) return fail(owner, "random-cooldown", Map.of("seconds", (remaining + 999) / 1_000));
        if (pendingTeleports.values().stream().filter(pending -> pending.random != null).count()
                >= MAX_RANDOM_SEARCHES) return fail(owner, "destination-busy", Map.of());
        var border = destination.getWorldBorder();
        var spawn = destination.getRespawnData().pos();
        int radius = Math.min(10_000, config.randomTeleportRadius());
        Optional<RandomTeleportArea> area = RandomTeleportArea.withinBorder(
                Math.max(border.getMinX(), (double) spawn.getX() - radius),
                Math.min(border.getMaxX(), (double) spawn.getX() + radius),
                Math.max(border.getMinZ(), (double) spawn.getZ() - radius),
                Math.min(border.getMaxZ(), (double) spawn.getZ() + radius));
        if (area.isEmpty()) return fail(owner, "random-no-safe-destination", Map.of());
        RandomDestination search = new RandomDestination(destination, area.get());
        if (!search.nextArea(owner)) return fail(owner, "random-no-safe-destination", Map.of());
        if (!revokeOutgoingBeforeLocalTravel(source, owner)) return 0;
        Dispatch dispatch = dispatchTeleport(owner, () -> search.key, () -> {
            if (!dimensionAllowed(owner, destination)) return false;
            if (search.landing == null || !teleportTravelGroup(source.getServer(), owner, destination,
                    search.landing, null, TravelGroupTrigger.RANDOM)) return false;
            send(owner, "random-teleported", Map.of());
            return true;
        }, () -> { }, () -> { }, search);
        if (dispatch.accepted()) {
            requests.startLocalTravelCooldown(owner.getUUID(), bypassCooldown);
            send(owner, "random-searching", Map.of());
        }
        return dispatch.accepted() ? 1 : 0;
    }

    private int teleportToSavedLocation(
            CommandSourceStack source,
            ServerPlayer owner,
            String requestedName) {
        SavedLocationStore store = locations;
        if (store == null) return fail(owner, "location-storage-failed", Map.of());
        String name = SavedLocationStore.normalizeName(requestedName);
        Optional<SavedLocation> match = store.find(owner.getUUID(), name);
        if (match.isEmpty()) {
            return fail(owner, "location-not-found", Map.of("name", requestedName));
        }

        SavedLocation location = match.get();
        Identifier dimensionId = Identifier.tryParse(location.dimension());
        if (dimensionId == null) {
            return fail(owner, "location-world-unavailable", Map.of("name", name));
        }
        ResourceKey<Level> dimension = ResourceKey.create(Registries.DIMENSION, dimensionId);
        ServerLevel destination = source.getServer().getLevel(dimension);
        if (destination == null) {
            return fail(owner, "location-world-unavailable", Map.of("name", name));
        }
        if (!travelAllowed(owner, destination, location)) return 0;
        if (!revokeOutgoingBeforeLocalTravel(source, owner)) return 0;
        Dispatch dispatch = dispatchTeleport(owner, () -> destinationKey(destination, location, owner), () -> {
            if (!teleportTravelGroup(
                    source.getServer(),
                    owner,
                    destination,
                    location,
                    null,
                    TravelGroupTrigger.SAVED_PLACE)) return false;
            send(owner, "location-teleported", Map.of("name", name));
            return true;
        }, () -> {
        }, () -> {
        });
        return dispatch.accepted() ? 1 : 0;
    }

    private int teleportBack(CommandSourceStack source) {
        ServerPlayer owner = player(source);
        if (owner == null) return 0;
        Optional<ReturnPoint> previous = returnLocations.find(owner.getUUID());
        if (previous.isEmpty()) return fail(owner, "back-unavailable", Map.of());

        ReturnPoint returnPoint = previous.get();
        SavedLocation location = returnPoint.playerLocation();
        Identifier dimensionId = Identifier.tryParse(location.dimension());
        if (dimensionId == null) return fail(owner, "back-world-unavailable", Map.of());
        ResourceKey<Level> dimension = ResourceKey.create(Registries.DIMENSION, dimensionId);
        ServerLevel destination = source.getServer().getLevel(dimension);
        if (destination == null) return fail(owner, "back-world-unavailable", Map.of());
        if (!travelAllowed(owner, destination, location)) return 0;
        Entity currentRoot = owner.getRootVehicle();
        SavedLocation rootOverride = currentRoot.getUUID().equals(returnPoint.primaryRootId())
                && returnPoint.primaryRootLocation().dimension().equals(location.dimension())
                ? returnPoint.primaryRootLocation()
                : null;
        if (!revokeOutgoingBeforeLocalTravel(source, owner)) return 0;
        Dispatch dispatch = dispatchTeleport(owner, () -> destinationKey(destination, location, owner), () -> {
            if (!teleportTravelGroup(
                    source.getServer(),
                    owner,
                    destination,
                    location,
                    rootOverride,
                    TravelGroupTrigger.BACK)) return false;
            send(owner, "back-teleported", Map.of());
            return true;
        }, () -> {
        }, () -> {
        });
        return dispatch.accepted() ? 1 : 0;
    }

    /**
     * Local travel supersedes consent for an older player-targeted request. Revoke that request
     * before moving so a late acceptance can never pull the player away from the place they chose.
     */
    private boolean revokeOutgoingBeforeLocalTravel(CommandSourceStack source, ServerPlayer requester) {
        RequestOutcome outcome = requests.cancel(requester.getUUID());
        if (outcome.status() == RequestOutcome.Status.NONE) return true;
        if (outcome.status() == RequestOutcome.Status.BUSY) {
            send(requester, "request-processing", Map.of());
            return false;
        }
        if (outcome.status() != RequestOutcome.Status.CANCELLED) return false;

        TeleportRequest request = outcome.request();
        send(requester, "cancelled-for-local-travel-requester",
                Map.of("target", request.targetName()));
        send(online(source.getServer(), request.targetId()), "cancelled-for-local-travel-target",
                Map.of("requester", request.requesterName()));
        LOGGER.info("Revoked {}'s pending TPA to {} before local saved-place travel.",
                request.requesterName(), request.targetName());
        return true;
    }

    private int respond(CommandSourceStack source, String requesterName, boolean accept) {
        ServerPlayer target = player(source);
        if (target == null) return 0;
        RequestOutcome outcome = requests.respond(target.getUUID(), requesterName, accept);
        if (outcome.status() == RequestOutcome.Status.AMBIGUOUS) {
            String names = String.join(", ", outcome.candidates().stream()
                    .map(TeleportRequest::requesterName)
                    .toList());
            send(target, "choose-request", Map.of("requests", names));
            return 0;
        }
        if (outcome.status() == RequestOutcome.Status.NONE) {
            if (requesterName == null || requesterName.isBlank()) {
                send(target, "no-pending", Map.of());
            } else {
                send(target, "no-matching-request", Map.of("requester", requesterName));
            }
            return 0;
        }
        if (outcome.status() == RequestOutcome.Status.BUSY) {
            send(target, "request-processing", Map.of());
            return 0;
        }

        TeleportRequest request = outcome.request();
        ServerPlayer requester = online(source.getServer(), request.requesterId());
        if (!accept) {
            send(requester, "denied-requester", Map.of("target", request.targetName()));
            send(target, "denied-target", Map.of("requester", request.requesterName()));
            return 1;
        }
        AcceptanceReservation reservation = outcome.reservation();
        if (outcome.status() != RequestOutcome.Status.RESERVED || reservation == null) {
            LOGGER.error("TPA acceptance did not produce a valid reservation.");
            return 0;
        }

        boolean resolved = false;
        try {
            if (requester == null) {
                send(target, "player-unavailable", Map.of());
                return 0;
            }
            if (!travelAllowed(requester, target.level(), locationOf(target))) {
                send(target, "request-failed-target", Map.of("requester", request.requesterName()));
                return 0;
            }
            Dispatch dispatch = dispatchTeleport(
                    requester,
                    () -> playerDestinationKey(source.getServer(), request.targetId(), requester),
                    () -> completeAcceptedTeleport(source.getServer(), reservation, request),
                    () -> {
                        requests.invalidate(reservation);
                        send(target, "request-cancelled-target", Map.of("requester", request.requesterName()));
                    },
                    () -> {
                        requests.release(reservation);
                        send(target, "request-failed-target", Map.of("requester", request.requesterName()));
                    });
            resolved = dispatch.accepted();
            if (!resolved) send(target, "request-failed-target", Map.of("requester", request.requesterName()));
            return resolved ? 1 : 0;
        } finally {
            if (!resolved && !requests.release(reservation)) {
                LOGGER.debug("TPA reservation was already invalidated before it could be released.");
            }
        }
    }

    private boolean completeAcceptedTeleport(
            MinecraftServer minecraftServer,
            AcceptanceReservation reservation,
            TeleportRequest request) {
        ServerPlayer requester = online(minecraftServer, request.requesterId());
        // Async terrain readiness can span many commands/ticks. Confirm the exact consent
        // still exists before preparing or moving any member of the travel group.
        if (!requests.isActiveReservation(reservation)) {
            send(requester, "teleport-failed", Map.of());
            return false;
        }
        ServerPlayer target = online(minecraftServer, request.targetId());
        if (requester == null || target == null) {
            send(requester, "player-unavailable", Map.of());
            send(target, "player-unavailable", Map.of());
            return false;
        }
        if (!travelAllowed(requester, target.level(), locationOf(target))) {
            send(target, "request-failed-target", Map.of("requester", request.requesterName()));
            return false;
        }
        if (!validPosition(target.getX(), target.getY(), target.getZ())) {
            send(requester, "teleport-failed", Map.of());
            send(target, "teleport-failed", Map.of());
            return false;
        }

        SavedLocation destination = new SavedLocation(
                dimensionName(target.level()),
                target.getX(), target.getY(), target.getZ(),
                target.getYRot(), target.getXRot());
        if (!teleportTravelGroup(
                minecraftServer,
                requester,
                target.level(),
                destination,
                null,
                TravelGroupTrigger.PLAYER_REQUEST)) {
            send(target, "teleport-failed", Map.of());
            return false;
        }
        boolean committed = requests.commit(reservation);
        if (!committed) {
            // Participant cleanup can invalidate a reservation, but it also consumes/removes the
            // old request. A completed teleport remains authoritative and cannot be replayed.
            LOGGER.warn("A completed TPA reservation was already invalidated during commit.");
        }
        send(requester, "accepted-requester", Map.of("target", request.targetName()));
        send(target, "accepted-target", Map.of("requester", request.requesterName()));
        return true;
    }

    /**
     * Teleports the player and a bounded, consent-safe travel group as one transaction.
     *
     * <p>The primary vehicle tree is moved by its root so boats, mounts, and all non-player
     * passengers keep their vanilla riding graph. Nearby non-sitting owned animals, lead chains,
     * and a non-player entity caught by the traveler's fishing hook are moved as separate roots.
     * Vanilla performs the actual entity transfer; this code never clones an entity.</p>
     */
    private boolean teleportTravelGroup(
            MinecraftServer minecraftServer,
            ServerPlayer traveler,
            ServerLevel destination,
            SavedLocation requestedLanding,
            SavedLocation primaryRootLandingOverride,
            TravelGroupTrigger trigger) {
        if (trigger == null || !trigger.automatic()) {
            throw new IllegalArgumentException("player teleport route must carry an automatic travel group");
        }
        if (!travelAllowed(traveler, destination, requestedLanding)) return false;
        if (!destinationReady(traveler, destination, requestedLanding)) return false;
        TravelPlan plan = prepareTravelPlan(
                traveler, destination, requestedLanding, primaryRootLandingOverride, trigger);
        if (plan == null) return false;

        RootMove primary = plan.moves().getFirst();
        Entity primaryRoot = traveler.getRootVehicle();
        AABB arrivalBounds = primaryRoot.getBoundingBox();
        for (Entity member : primaryRoot.getSelfAndPassengers().toList()) {
            arrivalBounds = arrivalBounds.minmax(member.getBoundingBox());
        }
        arrivalBounds = arrivalBounds.move(primary.landing().x() - primaryRoot.getX(),
                primary.landing().y() - primaryRoot.getY(), primary.landing().z() - primaryRoot.getZ());
        List<ChunkPos> arrivalChunks = chunksForBounds(arrivalBounds.inflate(16, 0, 16));
        // A moving target/planner offset must not bypass the final actual-landing return lock.
        SavedLocation actualLanding = new SavedLocation(dimensionName(destination),
                primary.landing().x() + traveler.getX() - primaryRoot.getX(),
                primary.landing().y() + traveler.getY() - primaryRoot.getY(),
                primary.landing().z() + traveler.getZ() - primaryRoot.getZ(), requestedLanding.yaw(), requestedLanding.pitch());
        if (!travelAllowed(traveler, destination, actualLanding)) return false;
        if (!chunksReady(new DestinationKey(destination, arrivalChunks))) {
            fail(traveler, "destination-chunk-unavailable", Map.of());
            return false;
        }
        boolean needsDelivery = traveler.level() != destination || !footprintSent(traveler, arrivalChunks);

        List<RootMove> moved = new ArrayList<>(plan.moves().size());
        for (RootMove move : plan.moves()) {
            Entity root = findEntity(minecraftServer, move.rootId());
            if (root == null || root.isRemoved()) {
                rollbackTravel(minecraftServer, moved, plan.rides(), plan.leashes(), plan.returnPoint().playerLocation());
                fail(traveler, "travel-entity-unavailable", Map.of());
                return false;
            }
            // Include this root before invoking vanilla teleport: a cross-world entity transfer can
            // move passengers before a later root creation fails, so rollback must cover both.
            moved.add(move);
            boolean teleported = root.teleportTo(
                    destination,
                    move.landing().x(),
                    move.landing().y(),
                    move.landing().z(),
                    Set.of(),
                    move.landing().yaw(),
                    move.landing().pitch(),
                    true);
            if (!teleported) {
                rollbackTravel(minecraftServer, moved, plan.rides(), plan.leashes(), plan.returnPoint().playerLocation());
                fail(traveler, "teleport-failed", Map.of());
                return false;
            }
            if (!allMembersArrived(minecraftServer, destination, move.memberOrigins())) {
                rollbackTravel(minecraftServer, moved, plan.rides(), plan.leashes(), plan.returnPoint().playerLocation());
                fail(traveler, "teleport-failed", Map.of());
                return false;
            }
        }

        if (!ridingGraphIntact(minecraftServer, plan.rides())) {
            rollbackTravel(minecraftServer, moved, plan.rides(), plan.leashes(), plan.returnPoint().playerLocation());
            fail(traveler, "teleport-failed", Map.of());
            return false;
        }
        if (!restoreLeashes(minecraftServer, plan.leashes())) {
            rollbackTravel(minecraftServer, moved, plan.rides(), plan.leashes(), plan.returnPoint().playerLocation());
            fail(traveler, "teleport-failed", Map.of());
            return false;
        }
        ServerPlayer arrived = online(minecraftServer, traveler.getUUID());
        if (arrived == null || arrived.level() != destination) {
            rollbackTravel(minecraftServer, moved, plan.rides(), plan.leashes(), plan.returnPoint().playerLocation());
            fail(traveler, "teleport-failed", Map.of());
            return false;
        }
        if (ReturnLockStore.isEscape(inRecentPvp(arrived, System.currentTimeMillis()),
                plan.returnPoint().playerLocation(), locationOf(arrived))) {
            try {
                returnLocks.arm(arrived.getUUID(), plan.returnPoint().playerLocation(), System.currentTimeMillis());
            } catch (IOException error) {
                rollbackTravel(minecraftServer, moved, plan.rides(), plan.leashes(), plan.returnPoint().playerLocation());
                LOGGER.error("Combat TPA rolled back: return-lock persistence failed: {}", error.getMessage());
                fail(traveler, "return-lock-storage-failed", Map.of());
                return false;
            }
            send(arrived, "return-lock-armed", Map.of("seconds", 300));
        }
        arrived.setYRot(requestedLanding.yaw());
        arrived.setXRot(requestedLanding.pitch());
        arrived.setYHeadRot(requestedLanding.yaw());
        arrived.resetFallDistance();
        if (needsDelivery) beginArrival(arrived, arrivalChunks);
        returnLocations.put(arrived.getUUID(), plan.returnPoint());
        if (plan.entityCount() > 1) {
            LOGGER.debug("Teleported {} with an automatic {} travel group of {} entities.",
                    arrived.getGameProfile().name(), trigger, plan.entityCount());
        }
        return true;
    }

    private boolean dimensionAllowed(ServerPlayer traveler, ServerLevel destination) {
        if (TeleportDimensionPolicy.allows(dimensionName(traveler.level()), dimensionName(destination))
                && (config.allowCrossDimension() || traveler.level() == destination)) return true;
        fail(traveler, "cross-dimension-disabled", Map.of());
        return false;
    }

    private boolean travelAllowed(ServerPlayer traveler, ServerLevel destination, SavedLocation landing) {
        if (!dimensionAllowed(traveler, destination)) return false;
        if (returnLocks == null || deathLockClearRetries.contains(traveler.getUUID())) {
            fail(traveler, "return-lock-storage-failed", Map.of());
            return false;
        }
        long remaining = returnLocks.remainingMillis(traveler.getUUID(), landing.dimension(),
                landing.x(), landing.z(), System.currentTimeMillis());
        if (remaining == 0) return true;
        fail(traveler, "return-lock-blocked", Map.of("seconds", ceilSeconds(remaining)));
        return false;
    }

    private boolean destinationReady(
            ServerPlayer traveler,
            ServerLevel destination,
            SavedLocation requestedLanding) {
        if (!validPosition(requestedLanding.x(), requestedLanding.y(), requestedLanding.z())) {
            fail(traveler, "teleport-failed", Map.of());
            return false;
        }
        ChunkPos center = ChunkPos.containing(BlockPos.containing(
                requestedLanding.x(), requestedLanding.y(), requestedLanding.z()));
        // Preparation has already finished asynchronously. Never synchronously load a chunk
        // from the teleport command or landing planner, including a newly moved target.
        if (destination.getChunkSource().getChunkNow(center.x(), center.z()) == null) {
            fail(traveler, "destination-chunk-unavailable", Map.of());
            return false;
        }
        return true;
    }

    private TravelPlan prepareTravelPlan(
            ServerPlayer traveler,
            ServerLevel destination,
            SavedLocation requestedLanding,
            SavedLocation primaryRootLandingOverride,
            TravelGroupTrigger trigger) {
        if (!validPosition(requestedLanding.x(), requestedLanding.y(), requestedLanding.z())) {
            fail(traveler, "teleport-failed", Map.of());
            return null;
        }
        if (!dimensionAllowed(traveler, destination)) return null;

        TravelGroupGraph<Entity> graph = createTravelGroupGraph(traveler);
        Entity primaryRoot = traveler.getRootVehicle();
        TravelGroupGraph.Result primary = graph.addRoot(primaryRoot, traveler);
        if (primary == TravelGroupGraph.Result.CONTAINS_OTHER_PLAYER) {
            fail(traveler, "travel-player-passenger", Map.of());
            return null;
        }
        if (primary == TravelGroupGraph.Result.TOO_LARGE) {
            fail(traveler, "travel-group-too-large", Map.of("max", MAX_TRAVEL_ENTITIES));
            return null;
        }
        if (!primary.accepted()) {
            fail(traveler, "travel-entity-unavailable", Map.of());
            return null;
        }

        List<Entity> nearbyPets = traveler.level().getEntities(
                        traveler,
                        traveler.getBoundingBox().inflate(NEARBY_PET_RANGE),
                        candidate -> isTravelingPet(candidate, traveler))
                .stream()
                .sorted(Comparator.comparingDouble(traveler::distanceToSqr))
                .toList();
        for (Entity pet : nearbyPets) {
            TravelGroupGraph.Result result = graph.addRoot(pet.getRootVehicle(), traveler);
            // A pet currently ridden by somebody else stays with that rider; they never consented.
            if (result == TravelGroupGraph.Result.CONTAINS_OTHER_PLAYER) continue;
            if (result == TravelGroupGraph.Result.TOO_LARGE) {
                fail(traveler, "travel-group-too-large", Map.of("max", MAX_TRAVEL_ENTITIES));
                return null;
            }
        }

        FishingHook fishingHook = traveler.fishing;
        Entity hooked = fishingHook == null ? null : fishingHook.getHookedIn();
        if (hooked != null
                && !(hooked instanceof ServerPlayer)
                && !hooked.isRemoved()
                && !isSittingOwnedPet(hooked, traveler)
                && hooked.level() == traveler.level()
                && hooked.distanceToSqr(traveler) <= HOOKED_ENTITY_RANGE * HOOKED_ENTITY_RANGE) {
            TravelGroupGraph.Result result = graph.addRoot(hooked.getRootVehicle(), traveler);
            if (result == TravelGroupGraph.Result.CONTAINS_OTHER_PLAYER) {
                fail(traveler, "travel-player-passenger", Map.of());
                return null;
            }
            if (result == TravelGroupGraph.Result.TOO_LARGE) {
                fail(traveler, "travel-group-too-large", Map.of("max", MAX_TRAVEL_ENTITIES));
                return null;
            }
        }

        TravelGroupGraph.Result leashExpansion = graph.expandLeashClosure(traveler);
        if (leashExpansion == TravelGroupGraph.Result.CONTAINS_OTHER_PLAYER) {
            fail(traveler, "travel-player-passenger", Map.of());
            return null;
        }
        if (leashExpansion == TravelGroupGraph.Result.TOO_LARGE) {
            fail(traveler, "travel-group-too-large", Map.of("max", MAX_TRAVEL_ENTITIES));
            return null;
        }
        if (!leashExpansion.accepted()) {
            fail(traveler, "travel-entity-unavailable", Map.of());
            return null;
        }

        List<Entity> graphMembers = graph.members();
        LinkedHashMap<UUID, Entity> members = new LinkedHashMap<>();
        for (Entity member : graphMembers) members.put(member.getUUID(), member);
        if (traveler.level() != destination) {
            for (Entity entity : graphMembers) {
                if (!entity.canTeleport(entity.level(), destination)) {
                    fail(traveler, "travel-dimension-unsupported", Map.of(
                            "entity", entity.getDisplayName().getString()));
                    return null;
                }
            }
        }

        List<Entity> graphRoots = graph.roots();
        Set<UUID> movingIds = Set.copyOf(members.keySet());
        ArrayList<RootMove> moves = new ArrayList<>(graphRoots.size());
        ArrayList<AABB> occupied = new ArrayList<>(graphRoots.size());
        boolean primaryMove = true;
        for (Entity root : graphRoots) {
            List<Entity> rootMembers = root.getSelfAndPassengers().toList();
            Optional<TravelLanding> landing = findTravelLanding(
                    destination,
                    root,
                    rootMembers,
                    traveler,
                    requestedLanding,
                    primaryMove ? primaryRootLandingOverride : null,
                    occupied,
                    primaryMove,
                    trigger.exactPlayerDestination(),
                    trigger == TravelGroupTrigger.RANDOM,
                    movingIds);
            if (landing.isEmpty()) {
                fail(traveler, "travel-destination-unsafe", Map.of());
                return null;
            }
            TravelLanding selected = landing.get();
            occupied.add(selected.bounds().inflate(0.1));
            moves.add(new RootMove(
                    root.getUUID(),
                    rootMembers.stream()
                            .map(member -> new EntityOrigin(member.getUUID(), locationOf(member)))
                            .toList(),
                    selected.location()));
            primaryMove = false;
        }

        ArrayList<LeashLink> leashes = new ArrayList<>();
        ArrayList<RideLink> rides = new ArrayList<>();
        for (Entity entity : members.values()) {
            Entity vehicle = entity.getVehicle();
            if (vehicle != null && members.containsKey(vehicle.getUUID())) {
                rides.add(new RideLink(entity.getUUID(), vehicle.getUUID()));
            }
            if (!(entity instanceof Leashable leashable)) continue;
            Entity holder = leashable.getLeashHolder();
            if (holder != null && members.containsKey(holder.getUUID())) {
                leashes.add(new LeashLink(entity.getUUID(), holder.getUUID()));
            }
        }
        return new TravelPlan(
                List.copyOf(moves),
                List.copyOf(rides),
                List.copyOf(leashes),
                new ReturnPoint(
                        locationOf(traveler),
                        primaryRoot.getUUID(),
                        locationOf(primaryRoot)),
                graph.size());
    }

    private static TravelGroupGraph<Entity> createTravelGroupGraph(ServerPlayer traveler) {
        return new TravelGroupGraph<>(MAX_TRAVEL_ENTITIES, new TravelGroupGraph.Adapter<>() {
            @Override
            public UUID id(Entity entity) {
                return entity == null ? null : entity.getUUID();
            }

            @Override
            public boolean unavailable(Entity entity) {
                return entity == null || entity.isRemoved();
            }

            @Override
            public boolean player(Entity entity) {
                return entity instanceof ServerPlayer;
            }

            @Override
            public Entity rootVehicle(Entity entity) {
                return entity == null ? null : entity.getRootVehicle();
            }

            @Override
            public List<Entity> selfAndPassengers(Entity root) {
                return root == null ? List.of() : root.getSelfAndPassengers().toList();
            }

            @Override
            public List<Entity> eligibleEntitiesLeashedTo(Entity holder) {
                if (holder == null || holder.isRemoved() || holder.level() != traveler.level()) {
                    return List.of();
                }
                ArrayList<Entity> attachedEntities = new ArrayList<>();
                for (Leashable leashable : Leashable.leashableLeashedTo(holder)) {
                    if (!(leashable instanceof Entity attached)
                            || attached.isRemoved()
                            || !attached.isAlive()
                            || isSittingOwnedPet(attached, traveler)
                            || attached.level() != traveler.level()) {
                        continue;
                    }
                    attachedEntities.add(attached);
                }
                attachedEntities.sort(Comparator.comparing(entity -> entity.getUUID().toString()));
                return List.copyOf(attachedEntities);
            }
        });
    }

    private static boolean isTravelingPet(Entity candidate, ServerPlayer traveler) {
        if (candidate == null || candidate.isRemoved() || !candidate.isAlive()) return false;
        if (!(candidate instanceof OwnableEntity ownable)
                || ownable.getOwner() == null
                || !ownable.getOwner().getUUID().equals(traveler.getUUID())) return false;
        if (isSittingOwnedPet(candidate, traveler)) return false;
        if (candidate instanceof Leashable leashable && leashable.isLeashed()) {
            // Pets tied to a fence or another entity do not get torn away. If the holder is part
            // of the travel group, the bounded lead traversal adds the pet from that holder.
            Entity holder = leashable.getLeashHolder();
            if (holder != null && !holder.getUUID().equals(traveler.getUUID())) return false;
        }
        return true;
    }

    private static boolean isSittingOwnedPet(Entity candidate, ServerPlayer traveler) {
        return candidate instanceof TamableAnimal pet
                && pet.getOwner() != null
                && pet.getOwner().getUUID().equals(traveler.getUUID())
                && (pet.isOrderedToSit() || pet.isInSittingPose());
    }

    private static Optional<TravelLanding> findTravelLanding(
            ServerLevel destination,
            Entity root,
            List<Entity> rootMembers,
            ServerPlayer traveler,
            SavedLocation requested,
            SavedLocation rootOverride,
            List<AABB> occupied,
            boolean primary,
            boolean exactPlayerDestination,
            boolean randomSurface,
            Set<UUID> movingIds) {
        ArrayList<Vec3> candidates = new ArrayList<>();
        boolean exactPrimaryDestination = primary && exactPlayerDestination;
        SavedLocation base;
        if (exactPrimaryDestination) {
            TravelLandingOffsets.Position exactRoot = TravelLandingOffsets.exactRootDestination(
                    requested.x(), requested.y(), requested.z(),
                    root.getX(), root.getY(), root.getZ(),
                    traveler.getX(), traveler.getY(), traveler.getZ());
            float rootYaw = root == traveler ? requested.yaw() : root.getYRot();
            float rootPitch = root == traveler ? requested.pitch() : root.getXRot();
            base = new SavedLocation(
                    requested.dimension(),
                    exactRoot.x(), exactRoot.y(), exactRoot.z(),
                    rootYaw, rootPitch);
        } else {
            base = primary && rootOverride != null ? rootOverride : requested;
        }
        double preferredX = primary ? 0.0 : clamp(root.getX() - traveler.getX(), -6.0, 6.0);
        double preferredZ = primary ? 0.0 : clamp(root.getZ() - traveler.getZ(), -6.0, 6.0);
        boolean carriesVehicleOrPassengers = root != traveler || rootMembers.size() > 1;
        for (TravelLandingOffsets.Offset offset : TravelLandingOffsets.candidates(
                primary,
                carriesVehicleOrPassengers,
                exactPrimaryDestination,
                preferredX,
                preferredZ,
                COMPANION_SPACING,
                COMPANION_SEARCH_RADIUS)) {
            if (randomSurface && primary && (offset.x() != 0.0 || offset.z() != 0.0)) continue;
            candidates.add(new Vec3(base.x() + offset.x(), base.y(), base.z() + offset.z()));
        }

        List<Integer> verticalOffsets = TravelLandingOffsets.verticalOffsets(
                primary, carriesVehicleOrPassengers, exactPrimaryDestination);
        for (Vec3 candidate : candidates) {
            for (int verticalOffset : verticalOffsets) {
                double x = candidate.x();
                double y = candidate.y() + verticalOffset;
                double z = candidate.z();
                double shiftX = x - root.getX();
                double shiftY = y - root.getY();
                double shiftZ = z - root.getZ();
                AABB groupBounds = null;
                boolean safe = true;
                for (Entity member : rootMembers) {
                    AABB shifted = member.getBoundingBox().move(shiftX, shiftY, shiftZ);
                    // Saved places/back are explicit exact coordinates. Air, solid blocks,
                    // water and lava remain the player's choice; never relocate that root.
                    if (!(exactPrimaryDestination ? isValidArrivalBounds(destination, shifted)
                            : isSafeBounds(destination, member, shifted))) {
                        safe = false;
                        break;
                    }
                    groupBounds = groupBounds == null ? shifted : groupBounds.minmax(shifted);
                }
                if (!safe || groupBounds == null) continue;
                if (randomSurface && !isSafeRandomSurface(destination, root,
                        root.getBoundingBox().move(shiftX, shiftY, shiftZ), true)) continue;
                if (randomSurface && rootMembers.stream().anyMatch(member -> !isSafeRandomSurface(
                        destination, member, member.getBoundingBox().move(shiftX, shiftY, shiftZ), false))) continue;
                if (!exactPrimaryDestination && carriesVehicleOrPassengers
                        && hasBlockingDestinationEntity(
                        destination, root, rootMembers, groupBounds, movingIds)) continue;
                boolean overlaps = false;
                for (AABB bounds : occupied) {
                    if (bounds.intersects(groupBounds)) {
                        overlaps = true;
                        break;
                    }
                }
                if (overlaps) continue;
                float yaw = exactPrimaryDestination
                        ? base.yaw()
                        : rootOverride != null
                        ? rootOverride.yaw()
                        : root == traveler ? requested.yaw() : root.getYRot();
                float pitch = exactPrimaryDestination
                        ? base.pitch()
                        : rootOverride != null
                        ? rootOverride.pitch()
                        : root == traveler ? requested.pitch() : root.getXRot();
                return Optional.of(new TravelLanding(
                        new SavedLocation(
                                destination.dimension().identifier().toString(),
                                x, y, z, yaw, pitch),
                        groupBounds));
            }
        }
        return Optional.empty();
    }

    private static boolean hasBlockingDestinationEntity(
            ServerLevel destination,
            Entity root,
            List<Entity> rootMembers,
            AABB bounds,
            Set<UUID> movingIds) {
        return !destination.getEntities(
                root,
                bounds.deflate(1.0E-7),
                other -> !other.isRemoved()
                        && !other.isSpectator()
                        && !movingIds.contains(other.getUUID())
                        && rootMembers.stream().anyMatch(member ->
                        member.canCollideWith(other) || other.canCollideWith(member)))
                .isEmpty();
    }

    private static boolean isSafeBounds(ServerLevel destination, Entity entity, AABB bounds) {
        if (!isValidArrivalBounds(destination, bounds)) return false;
        if (!destination.noBlockCollision(entity, bounds)) return false;
        for (BlockPos position : BlockPos.betweenClosed(bounds.deflate(1.0E-7))) {
            if (destination.getFluidState(position).is(FluidTags.LAVA)) return false;
        }
        return true;
    }

    /** Check loaded blocks only; random choices require dry, hazard-free, fully supported land. */
    private static boolean isSafeRandomSurface(ServerLevel destination, Entity entity, AABB bounds,
                                              boolean requireFloor) {
        AABB platform = requireFloor ? bounds.inflate(1.0, 0.0, 1.0) : bounds;
        AABB inspection = platform.inflate(0.25, 0.0, 0.25).expandTowards(0.0, -1.0, 0.0);
        if (!allChunksReady(destination, inspection) || !isSafeBounds(destination, entity, bounds)) return false;
        if (!destination.getWorldBorder().isWithinBounds(platform)
                || !destination.noBlockCollision(entity, platform)) return false;
        for (BlockPos position : BlockPos.betweenClosed(inspection.deflate(1.0E-7))) {
            var state = destination.getBlockState(position);
            if (!state.getFluidState().isEmpty()
                    || RandomLandingSafety.hazardous(BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString())) {
                return false;
            }
        }
        if (requireFloor) {
            int floorY = (int) Math.floor(bounds.minY - 1.0E-7);
            for (int x = (int) Math.floor(platform.minX); x <= (int) Math.floor(Math.nextDown(platform.maxX)); x++) {
                for (int z = (int) Math.floor(platform.minZ); z <= (int) Math.floor(Math.nextDown(platform.maxZ)); z++) {
                    BlockPos floor = new BlockPos(x, floorY, z);
                    if (Math.abs(bounds.minY - (floorY + 1)) > 1.0E-5
                            || !destination.getBlockState(floor).isFaceSturdy(destination, floor, Direction.UP)) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    private static boolean isValidArrivalBounds(ServerLevel destination, AABB bounds) {
        if (!validPosition(bounds.getCenter().x(), bounds.minY, bounds.getCenter().z())) return false;
        if (bounds.minY < destination.getMinY() || bounds.maxY > destination.getMaxY()) return false;
        if (!allChunksReady(destination, bounds)) return false;
        BlockPos feet = BlockPos.containing(bounds.getCenter().x(), bounds.minY, bounds.getCenter().z());
        BlockPos head = BlockPos.containing(bounds.getCenter().x(), bounds.maxY - 1.0E-7, bounds.getCenter().z());
        if (!destination.isInWorldBounds(feet) || !destination.isInWorldBounds(head)) return false;
        if (!destination.getWorldBorder().isWithinBounds(bounds)) return false;
        return true;
    }

    private static boolean allChunksReady(ServerLevel destination, AABB bounds) {
        int minChunkX = ((int) Math.floor(bounds.minX)) >> 4;
        int maxChunkX = ((int) Math.floor(Math.nextDown(bounds.maxX))) >> 4;
        int minChunkZ = ((int) Math.floor(bounds.minZ)) >> 4;
        int maxChunkZ = ((int) Math.floor(Math.nextDown(bounds.maxZ))) >> 4;
        for (int chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
            for (int chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
                if (destination.getChunkSource().getChunkNow(chunkX, chunkZ) == null) return false;
            }
        }
        return true;
    }

    private static boolean allMembersArrived(
            MinecraftServer minecraftServer,
            ServerLevel destination,
            List<EntityOrigin> memberOrigins) {
        for (EntityOrigin origin : memberOrigins) {
            Entity member = findEntity(minecraftServer, origin.entityId());
            if (member == null || member.isRemoved() || member.level() != destination) return false;
        }
        return true;
    }

    private static boolean ridingGraphIntact(MinecraftServer minecraftServer, List<RideLink> links) {
        for (RideLink link : links) {
            Entity passenger = findEntity(minecraftServer, link.passengerId());
            Entity vehicle = findEntity(minecraftServer, link.vehicleId());
            if (passenger == null || vehicle == null || passenger.getVehicle() != vehicle) return false;
        }
        return true;
    }

    private void rollbackTravel(
            MinecraftServer minecraftServer,
            List<RootMove> moved,
            List<RideLink> rides,
            List<LeashLink> leashes,
            SavedLocation playerOrigin) {
        boolean positionsRestored = true;
        LinkedHashMap<UUID, EntityOrigin> origins = new LinkedHashMap<>();
        for (RootMove move : moved) {
            for (EntityOrigin origin : move.memberOrigins()) origins.put(origin.entityId(), origin);
        }
        // Detach first so every member can be restored independently even if vanilla completed
        // only part of a cross-dimension passenger transfer.
        for (UUID entityId : origins.keySet()) {
            Entity current = findEntity(minecraftServer, entityId);
            if (current != null && current.isPassenger()) current.stopRiding();
        }
        for (EntityOrigin origin : origins.values()) {
            Entity current = findEntity(minecraftServer, origin.entityId());
            ServerLevel originLevel = resolveLevel(minecraftServer, origin.location().dimension());
            if (current == null || originLevel == null || !current.teleportTo(
                    originLevel,
                    origin.location().x(),
                    origin.location().y(),
                    origin.location().z(),
                    Set.of(),
                    origin.location().yaw(),
                    origin.location().pitch(),
                    true)) {
                positionsRestored = false;
            }
        }
        boolean ridesRestored = restoreRides(minecraftServer, rides, origins.keySet());
        boolean leashesRestored = restoreLeashes(minecraftServer, leashes);
        ServerPlayer restored = origins.keySet().stream()
                .map(id -> online(minecraftServer, id))
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElse(null);
        if (restored != null) {
            restored.setYRot(playerOrigin.yaw());
            restored.setXRot(playerOrigin.pitch());
            restored.setYHeadRot(playerOrigin.yaw());
            restored.resetFallDistance();
        }
        if (!rollbackComplete(positionsRestored, ridesRestored, leashesRestored)) {
            LOGGER.error(
                    "A Server Teleport travel-group rollback was incomplete "
                            + "(positions={}, rides={}, leashes={}); no entities were cloned by the mod.",
                    positionsRestored,
                    ridesRestored,
                    leashesRestored);
        }
    }

    static boolean rollbackComplete(
            boolean positionsRestored,
            boolean ridesRestored,
            boolean leashesRestored) {
        return positionsRestored && ridesRestored && leashesRestored;
    }

    private static boolean restoreRides(
            MinecraftServer minecraftServer,
            List<RideLink> links,
            Set<UUID> restoredEntityIds) {
        boolean complete = true;
        for (RideLink link : links) {
            if (!restoredEntityIds.contains(link.passengerId())
                    || !restoredEntityIds.contains(link.vehicleId())) continue;
            Entity passenger = findEntity(minecraftServer, link.passengerId());
            Entity vehicle = findEntity(minecraftServer, link.vehicleId());
            if (passenger == null || vehicle == null || passenger.level() != vehicle.level()) {
                complete = false;
                continue;
            }
            if (passenger.getVehicle() != vehicle) {
                if (passenger.isPassenger()) passenger.stopRiding();
                if (!passenger.startRiding(vehicle, true, false)) complete = false;
            }
            if (passenger.getVehicle() != vehicle) complete = false;
        }
        return complete;
    }

    private static boolean restoreLeashes(MinecraftServer minecraftServer, List<LeashLink> links) {
        boolean complete = true;
        for (LeashLink link : links) {
            Entity entity = findEntity(minecraftServer, link.leashedId());
            Entity holder = findEntity(minecraftServer, link.holderId());
            if (!(entity instanceof Leashable leashable)
                    || holder == null
                    || entity.isRemoved()
                    || holder.isRemoved()
                    || entity.level() != holder.level()) {
                complete = false;
                continue;
            }
            if (leashable.getLeashHolder() != holder) {
                leashable.setLeashedTo(holder, true);
            }
            if (leashable.getLeashHolder() != holder) complete = false;
        }
        return complete;
    }

    private static Entity findEntity(MinecraftServer minecraftServer, UUID entityId) {
        if (minecraftServer == null || entityId == null) return null;
        ServerPlayer player = online(minecraftServer, entityId);
        if (player != null) return player;
        for (ServerLevel level : minecraftServer.getAllLevels()) {
            Entity entity = level.getEntity(entityId);
            if (entity != null && !entity.isRemoved()) return entity;
        }
        return null;
    }

    private static ServerLevel resolveLevel(MinecraftServer minecraftServer, String dimensionName) {
        Identifier identifier = Identifier.tryParse(dimensionName);
        if (identifier == null) return null;
        return minecraftServer.getLevel(ResourceKey.create(Registries.DIMENSION, identifier));
    }

    private static SavedLocation locationOf(Entity entity) {
        return new SavedLocation(
                entity.level().dimension().identifier().toString(),
                entity.getX(),
                entity.getY(),
                entity.getZ(),
                entity.getYRot(),
                entity.getXRot());
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private int cancel(CommandSourceStack source) {
        ServerPlayer requester = player(source);
        if (requester == null) return 0;
        boolean cancelledWarmup = cancelPendingTeleport(
                requester, "warmup-cancelled-manual", true);
        RequestOutcome outcome = requests.cancel(requester.getUUID());
        if (outcome.status() == RequestOutcome.Status.BUSY) {
            send(requester, "request-processing", Map.of());
            return 0;
        }
        if (outcome.status() != RequestOutcome.Status.CANCELLED) {
            if (cancelledWarmup) return 1;
            send(requester, "no-pending", Map.of());
            return 0;
        }
        TeleportRequest request = outcome.request();
        send(requester, "cancelled-requester", Map.of());
        send(online(source.getServer(), request.targetId()), "cancelled-target",
                Map.of("requester", request.requesterName()));
        return 1;
    }

    private int reload(CommandSourceStack source) {
        try {
            applyConfig(TeleportConfig.load(configFile));
            send(source, "reload-complete", Map.of());
            LOGGER.info("Server Teleport config reloaded by {}.", source.getTextName());
            return 1;
        } catch (IOException error) {
            send(source, "reload-failed", Map.of());
            LOGGER.error("Server Teleport config reload failed: {}", error.getMessage());
            return 0;
        }
    }

    private void applyConfig(TeleportConfig loaded) {
        requests.configure(
                loaded.requestExpiryMillis(),
                loaded.requestCooldownMillis(),
                loaded.maxIncomingRequests(),
                loaded.maxTotalPending());
        config = loaded;
    }

    private int usage(CommandSourceStack source, String key) {
        send(source, key, Map.of());
        return 0;
    }

    private ServerPlayer player(CommandSourceStack source) {
        ServerPlayer player = source.getPlayer();
        if (player == null) send(source, "players-only", Map.of());
        return player;
    }

    private List<String> onlinePlayerNames(CommandSourceStack source) {
        ServerPlayer requester = source.getPlayer();
        UUID requesterId = requester == null ? null : requester.getUUID();
        List<String> names = new ArrayList<>();
        for (ServerPlayer candidate : source.getServer().getPlayerList().getPlayers()) {
            if (!candidate.hasDisconnected() && !candidate.getUUID().equals(requesterId)) {
                names.add(candidate.getGameProfile().name());
            }
        }
        names.sort(String.CASE_INSENSITIVE_ORDER);
        return List.copyOf(names);
    }

    private List<String> savedLocationNames(CommandSourceStack source) {
        ServerPlayer owner = source.getPlayer();
        SavedLocationStore store = locations;
        if (owner == null || store == null) return List.of();
        return store.names(owner.getUUID());
    }

    /** Shows bare exact matches from both namespaces for the greedy shorthand resolver. */
    private List<String> tpaRootSuggestions(CommandSourceStack source) {
        TreeMap<String, String> suggestions = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (String name : savedLocationNames(source)) suggestions.put(name, name);
        for (String name : onlinePlayerNames(source)) suggestions.putIfAbsent(name, name);
        return List.copyOf(suggestions.values());
    }

    private List<String> incomingRequesters(CommandSourceStack source) {
        ServerPlayer target = source.getPlayer();
        if (target == null) return List.of();
        return requests.incomingFor(target.getUUID()).stream()
                .map(TeleportRequest::requesterName)
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .toList();
    }

    private static ServerPlayer findOnlineByName(MinecraftServer minecraftServer, String name) {
        if (name == null || !name.matches("[A-Za-z0-9_]{1,16}")) return null;
        for (ServerPlayer player : minecraftServer.getPlayerList().getPlayers()) {
            if (!player.hasDisconnected() && player.getGameProfile().name().equalsIgnoreCase(name)) return player;
        }
        return null;
    }

    private static String cleanDestinationName(String value) {
        return value == null ? "" : value.strip();
    }

    private static ServerPlayer online(MinecraftServer minecraftServer, UUID playerId) {
        if (minecraftServer == null || playerId == null) return null;
        ServerPlayer player = minecraftServer.getPlayerList().getPlayer(playerId);
        return player == null || player.hasDisconnected() ? null : player;
    }

    private static boolean validPosition(double x, double y, double z) {
        return Double.isFinite(x) && Double.isFinite(y) && Double.isFinite(z)
                && Math.abs(x) <= 30_000_000.0 && Math.abs(z) <= 30_000_000.0;
    }

    private int fail(ServerPlayer player, String key, Map<String, ?> values) {
        send(player, key, values);
        return 0;
    }

    private void send(ServerPlayer player, String key, Map<String, ?> values) {
        if (player == null) return;
        String rendered = config.messages().render(key, values);
        if (!rendered.isEmpty()) player.sendSystemMessage(FabricMessageComponent.parse(rendered));
    }

    private void sendRequestPrompt(ServerPlayer player, String requesterName) {
        if (player == null) return;
        String prefix = config.messages().render(
                "request-received-prompt", Map.of("requester", requesterName));
        if (!prefix.isEmpty()) {
            player.sendSystemMessage(FabricMessageComponent.teleportRequestPrompt(prefix, requesterName));
        }
    }

    private void send(CommandSourceStack source, String key, Map<String, ?> values) {
        String rendered = config.messages().render(key, values);
        if (!rendered.isEmpty()) source.sendSystemMessage(FabricMessageComponent.parse(rendered));
    }

    private static long ceilSeconds(long milliseconds) {
        return Math.max(1L, (milliseconds + 999L) / 1_000L);
    }

    @FunctionalInterface
    private interface TeleportAction {
        boolean execute();
    }

    private enum Dispatch {
        REJECTED,
        FAILED,
        COMPLETED,
        SCHEDULED;

        boolean accepted() {
            return this == COMPLETED || this == SCHEDULED;
        }
    }

    /** Opt-in native regression checks; construction requires an isolated fixture marker as well as the flag. */
    private final class RandomNativeTest {
        private final MinecraftServer server;
        private final TeleportConfig originalConfig;
        private final double originalBorderSize;
        private final double originalBorderX;
        private final double originalBorderZ;
        private NativeTestPlayer player;
        private boolean tracked;
        private int stage;
        private final long deadline = System.currentTimeMillis() + 60_000L;

        private RandomNativeTest(MinecraftServer server) {
            this.server = server;
            this.originalConfig = config;
            var border = server.overworld().getWorldBorder();
            originalBorderSize = border.getSize();
            originalBorderX = border.getCenterX();
            originalBorderZ = border.getCenterZ();
        }

        private void tick() {
            try {
                check(System.currentTimeMillis() < deadline, "native random test deadline");
                if (stage == 0) {
                    server.overworld().getWorldBorder().setCenter(0, 0);
                    server.overworld().getWorldBorder().setSize(20_000);
                    config = new TeleportConfig(config.requestExpiryMillis(), config.requestCooldownMillis(),
                            config.maxIncomingRequests(), config.maxTotalPending(), true, 10_000, config.messages());
                    verifyDimensionRoutes();
                    player = new NativeTestPlayer(server);
                    player.setPos(0.5, 80, 0.5);
                    server.getPlayerList().getPlayersByUUID().put(player.getUUID(), player);
                    server.getPlayerList().getPlayers().add(player);
                    // Native arrival movement requires the same ChunkMap/DistanceManager indexes
                    // that a real login establishes; PlayerList lookup alone is insufficient.
                    player.level().getChunkSource().addEntity(player);
                    tracked = true;
                    CommandSourceStack source = player.createCommandSourceStack().withPermission(PermissionSet.NO_PERMISSIONS);
                    var dispatcher = server.getCommands().getDispatcher();
                    var parsed = dispatcher.parse("rtpa", source);
                    check(parsed.getContext().getNodes().getLast().getNode().getName().equals("rtpa"), "public rtpa route");
                    check(dispatcher.getCompletionSuggestions(dispatcher.parse("rt", source)).getNow(null)
                            .getList().stream().anyMatch(suggestion -> suggestion.getText().equals("rtpa")), "non-op completion");
                    check(dispatcher.execute(parsed) == 1, "non-op random command accepted");
                    check(pendingTeleports.containsKey(player.getUUID()), "random uses async dispatcher");
                    stage = 1;
                    return;
                }
                if (stage == 1 && pendingTeleports.containsKey(player.getUUID())) return;
                if (stage == 1) {
                    check(returnLocations.find(player.getUUID()).isPresent(), "successful random return point");
                    check(player.level() == server.overworld(), "Overworld destination");
                    check(server.overworld().getWorldBorder().isWithinBounds(player.getBoundingBox()), "actual border bounds");
                    check(isSafeRandomSurface(player.level(), player, player.getBoundingBox(), true), "safe surface");
                    finishArrival(player.getUUID());
                    check(teleportRandom(player.createCommandSourceStack().withPermission(PermissionSet.NO_PERMISSIONS)) == 0,
                            "shared cooldown rejects repeat");
                    BlockPos floor = player.blockPosition().below();
                    var original = player.level().getBlockState(floor);
                    try {
                        for (var hazard : List.of(Blocks.LAVA, Blocks.WATER, Blocks.MAGMA_BLOCK, Blocks.CACTUS,
                                Blocks.POWDER_SNOW, Blocks.CAMPFIRE, Blocks.AIR)) {
                            player.level().setBlock(floor, hazard.defaultBlockState(), 3);
                            check(!isSafeRandomSurface(player.level(), player, player.getBoundingBox(), true),
                                    "reject hazardous/unsupported floor " + hazard);
                        }
                    } finally { player.level().setBlock(floor, original, 3); }
                    markRecentPvp(player.getUUID(), System.currentTimeMillis());
                    check(teleportRandom(player.createCommandSourceStack().withPermission(PermissionSet.ALL_PERMISSIONS)) == 1,
                            "combat random queued");
                    check(pendingTeleports.get(player.getUUID()).state != null, "combat warmup retained");
                    player.setPos(player.getX() + 0.2, player.getY(), player.getZ());
                    stage = 2;
                    return;
                }
                if (stage == 2) {
                    check(!pendingTeleports.containsKey(player.getUUID()), "movement cancels random combat warmup");
                    check(player.messages.stream().anyMatch(message -> message.contains("because you moved")), "cancellation message");
                    check(teleportRandom(player.createCommandSourceStack().withPermission(PermissionSet.ALL_PERMISSIONS)) == 1,
                            "second combat warmup queued before life reset");
                    check(pendingTeleports.get(player.getUUID()).state != null, "pre-death combat countdown");
                    ReturnPoint previousBack = returnLocations.find(player.getUUID()).orElseThrow();
                    requests.startLocalTravelCooldown(player.getUUID(), false);
                    onPlayerDeath(player);
                    check(!pendingTeleports.containsKey(player.getUUID()), "death cancels queued warmup");
                    check(!recentPvpUntil.containsKey(player.getUUID()), "death clears old fight marker");
                    check(requests.remainingCooldownMillis(player.getUUID(), false) == 0,
                            "death clears previous-life travel cooldown");
                    check(returnLocations.find(player.getUUID()).orElseThrow().equals(previousBack),
                            "death preserves back location");
                    returnLocks.arm(player.getUUID(), locationOf(player), System.currentTimeMillis());
                    check(!travelAllowed(player, player.level(), locationOf(player)), "return lock rejects actual fight area");
                    check(dimensionAllowed(player, server.getLevel(Level.NETHER)), "Nether travel permitted");
                    check(dimensionAllowed(player, server.getLevel(Level.END)), "End travel permitted");
                    onPlayerDeath(player);
                    check(travelAllowed(player, player.level(), locationOf(player)), "death clears durable return lock");
                    check(teleportRandom(player.createCommandSourceStack().withPermission(PermissionSet.NO_PERMISSIONS)) == 1,
                            "post-death non-op travel can start immediately");
                    check(pendingTeleports.get(player.getUUID()).state == null, "no inherited post-death combat countdown");
                    cancelPendingTeleport(player, "", false);
                    markRecentPvp(player.getUUID(), System.currentTimeMillis());
                    check(teleportRandom(player.createCommandSourceStack().withPermission(PermissionSet.ALL_PERMISSIONS)) == 1,
                            "new fight accepts normal queued travel");
                    check(pendingTeleports.get(player.getUUID()).state != null, "new fight restores normal countdown");
                    LOGGER.info("SERVER_RANDOM_TPA_NATIVE_TEST_PASS: non-op registered literal/completion, async terrain, safe bounded Overworld landing, hazards, cooldown, PvP warmup/movement cancellation, back point, death life-reset, immediate post-death travel, new-fight countdown.");
                    close();
                }
            } catch (Exception error) {
                LOGGER.error("SERVER_RANDOM_TPA_NATIVE_TEST_FAIL: {}", error.getMessage(), error);
                close();
            }
        }

        private void close() {
            config = originalConfig;
            server.overworld().getWorldBorder().setCenter(originalBorderX, originalBorderZ);
            server.overworld().getWorldBorder().setSize(originalBorderSize);
            if (player != null) {
                cancelPendingTeleport(player, "", false);
                finishArrival(player.getUUID());
                recentPvpUntil.remove(player.getUUID());
                returnLocations.remove(player.getUUID());
                requests.removePlayer(player.getUUID());
                if (tracked) player.level().getChunkSource().removeEntity(player);
                server.getPlayerList().getPlayersByUUID().remove(player.getUUID());
                server.getPlayerList().getPlayers().remove(player);
            }
            randomNativeTest = null;
        }

        private void verifyDimensionRoutes() {
            NativeTestPlayer probe=new NativeTestPlayer(server);
            for (ServerLevel origin:List.of(server.overworld(),server.getLevel(Level.NETHER),server.getLevel(Level.END))) {
                probe.setServerLevel(origin);probe.setPos(0.5,80,0.5);
                for (ServerLevel destination:List.of(server.overworld(),server.getLevel(Level.NETHER),server.getLevel(Level.END)))
                    check(dimensionAllowed(probe,destination),"normal TPA across "+origin.dimension()+" -> "+destination.dimension());
                check(teleportRandom(probe.createCommandSourceStack().withPermission(PermissionSet.ALL_PERMISSIONS))==1,"random origin accepted");
                check(pendingTeleports.get(probe.getUUID()).random.level==origin,"random stays in its origin dimension");
                cancelPendingTeleport(probe,"",false);
            }
            ServerLevel nether=server.getLevel(Level.NETHER);
            for(int cx=-1;cx<=0;cx++)for(int cz=-1;cz<=0;cz++)nether.getChunk(cx,cz);
            probe.setServerLevel(nether);probe.setPos(0.5,80,0.5);
            for(int x=-2;x<=2;x++)for(int z=-2;z<=2;z++)for(int y=79;y<=82;y++)
                nether.setBlock(new BlockPos(x,y,z),(y==79?Blocks.STONE:Blocks.AIR).defaultBlockState(),3);
            check(isSafeRandomSurface(nether,probe,probe.getBoundingBox(),true),"Nether broad platform accepted");
            nether.setBlock(new BlockPos(1,79,0),Blocks.AIR.defaultBlockState(),3);
            check(!isSafeRandomSurface(nether,probe,probe.getBoundingBox(),true),"Nether narrow ledge rejected");
            nether.setBlock(new BlockPos(1,79,0),Blocks.LAVA.defaultBlockState(),3);
            check(!isSafeRandomSurface(nether,probe,probe.getBoundingBox(),true),"Nether lava rejected");
            LOGGER.info("DIMENSION_TPA_NATIVE_PASS: all dimension pairs, current-dimension RTPA, Nether broad floor and lava/ledge rejection");
        }

        private void check(boolean condition, String message) {
            if (!condition) throw new IllegalStateException(message);
        }
    }

    private static final class NativeTestPlayer extends ServerPlayer {
        private final List<String> messages = new ArrayList<>();
        private NativeTestPlayer(MinecraftServer server) {
            super(server, server.overworld(), new GameProfile(UUID.randomUUID(), "RandomTpaTest"), ClientInformation.createDefault());
            connection = new ServerGamePacketListenerImpl(server, new net.minecraft.network.Connection(PacketFlow.SERVERBOUND), this,
                    CommonListenerCookie.createInitial(getGameProfile(), false)) {
                @Override public void send(Packet<?> packet) { }
            };
        }
        @Override public boolean hasDisconnected() { return false; }
        @Override public void sendSystemMessage(Component message) { messages.add(message.getString()); }
        @Override public void sendSystemMessage(Component message, boolean overlay) { messages.add(message.getString()); }
    }

    /** A maximum of eight small asynchronous footprints; one 81-column scan per server tick. */
    private final class RandomDestination {
        private final ServerLevel level;
        private final RandomTeleportArea area;
        private int attempts;
        private RandomTeleportArea.Column column;
        private DestinationKey key;
        private SavedLocation landing;
        private CompletableFuture<Boolean> freshness;
        private boolean approved;

        private RandomDestination(ServerLevel level, RandomTeleportArea area) {
            this.level = level;
            this.area = area;
        }

        private boolean nextArea(ServerPlayer player) {
            if (attempts++ >= MAX_RANDOM_AREAS) return false;
            var spawn = level.getRespawnData().pos();
            Optional<RandomTeleportArea.Column> sampled = area.sampleNearSpawn(ThreadLocalRandom.current(),
                    spawn.getX(), spawn.getZ(), config.randomTeleportRadius());
            if (sampled.isEmpty()) return false;
            column = sampled.get();
            approved = false;
            landing = null;
            int cx = column.x() >> 4, cz = column.z() >> 4;
            Path region = net.minecraft.world.level.dimension.DimensionType.getStorageFolder(
                    level.dimension(), activeServer.getWorldPath(LevelResource.ROOT)).resolve("region");
            try {
                freshness = CompletableFuture.supplyAsync(() -> UnexploredRegionCheck.clear(region, cx, cz, 8),
                        randomAreaReader).exceptionally(error -> false);
            } catch (java.util.concurrent.RejectedExecutionException error) {
                return false;
            }
            SavedLocation center = new SavedLocation(dimensionName(level), column.x() + 0.5,
                    player.getY(), column.z() + 0.5, player.getYRot(), player.getXRot());
            // Expand the ordinary companion-aware footprint by the small column search radius.
            key = new DestinationKey(level, chunksForBounds(destinationBounds(center, player)
                    .inflate(16 + RANDOM_COLUMN_RADIUS + 1, 0, 16 + RANDOM_COLUMN_RADIUS + 1)));
            return true;
        }

        private boolean nearLoadedArea() {
            for (int x = (column.x() >> 4) - 8; x <= (column.x() >> 4) + 8; x++)
                for (int z = (column.z() >> 4) - 8; z <= (column.z() >> 4) + 8; z++)
                    if (level.getChunkSource().getChunkNow(x, z) != null) return true;
            return false;
        }

        private boolean findSurface(ServerPlayer player) {
            // Reject every structure type, including underground strongholds, before landing.
            for (ChunkPos pos : key.chunks()) {
                var chunk = level.getChunkSource().getChunkNow(pos.x(), pos.z());
                if (chunk == null || chunk.hasAnyStructureReferences()
                        || chunk.getAllStarts().values().stream().anyMatch(start -> start.isValid())) return false;
            }
            if (level.players().stream().anyMatch(other -> other != player
                    && Math.hypot(other.getX() - column.x(), other.getZ() - column.z()) < 128)) return false;
            for (int dx = -RANDOM_COLUMN_RADIUS; dx <= RANDOM_COLUMN_RADIUS; dx++) {
                for (int dz = -RANDOM_COLUMN_RADIUS; dz <= RANDOM_COLUMN_RADIUS; dz++) {
                    int x = column.x() + dx;
                    int z = column.z() + dz;
                    if (!area.contains(x, z)) continue;
                    var chunk = level.getChunkSource().getChunkNow(x >> 4, z >> 4);
                    if (chunk == null) continue;
                    // Only the Nether searches below its bedrock roof. Other dimensions keep
                    // the surface-only rule, avoiding caves and ocean floors.
                    boolean nether = level.dimension().equals(Level.NETHER);
                    int top = nether ? Math.min(125, level.getMaxY()-3)
                            : chunk.getHeight(Heightmap.Types.WORLD_SURFACE, x & 15, z & 15) + 1;
                    int bottom = nether ? level.getMinY()+2 : top;
                    for (int y=top;y>=bottom;y--) {
                    BlockPos feet = new BlockPos(x,y,z);
                    if (!chunk.getBlockState(feet).isAir()
                            || !chunk.getBlockState(feet.above()).isAir()
                            || !chunk.getBlockState(feet.below()).isFaceSturdy(level,feet.below(),Direction.UP)) continue;
                    AABB bounds = player.getBoundingBox().move(
                            x + 0.5 - player.getX(), y - player.getY(), z + 0.5 - player.getZ());
                    if (!isSafeRandomSurface(level, player, bounds, true)) continue;
                    landing = new SavedLocation(dimensionName(level), x + 0.5, y, z + 0.5,
                            player.getYRot(), player.getXRot());
                    return true;
                    }
                }
            }
            return false;
        }
    }

    private static final class PendingTeleport {
        private final ServerPlayer player;
        private final TeleportWarmupState state;
        private final String originDimension;
        private final long deadlineMillis;
        private final Supplier<DestinationKey> destination;
        private final TeleportAction action;
        private final Runnable cancelWarmup;
        private final Runnable releaseAfterFailure;
        private final RandomDestination random;
        private DestinationLoads.Lease<DestinationKey> load;
        private boolean loadingAnnounced;
        private int destinationChanges;

        private PendingTeleport(ServerPlayer player, TeleportWarmupState state, String originDimension, long deadlineMillis,
                                Supplier<DestinationKey> destination, TeleportAction action,
                                Runnable cancelWarmup, Runnable releaseAfterFailure, RandomDestination random) {
            this.player = player;
            this.state = state;
            this.originDimension = Objects.requireNonNull(originDimension, "originDimension");
            this.deadlineMillis = deadlineMillis;
            this.destination = Objects.requireNonNull(destination, "destination");
            this.action = Objects.requireNonNull(action, "action");
            this.cancelWarmup = Objects.requireNonNull(cancelWarmup, "cancelWarmup");
            this.releaseAfterFailure = Objects.requireNonNull(releaseAfterFailure, "releaseAfterFailure");
            this.random = random;
        }

        private TeleportWarmupState state() { return state; }
        private TeleportAction action() { return action; }
        private Runnable cancelWarmup() { return cancelWarmup; }
        private Runnable releaseAfterFailure() { return releaseAfterFailure; }
    }

    private record ChunkTicketKey(ServerLevel level, ChunkPos chunk) { }

    private record ArrivalGuard(ServerPlayer player, ServerLevel level, Vec3 position,
                                Entity root, Vec3 rootPosition, boolean rootNoGravity, List<ChunkPos> chunks,
                                ArrivalReadiness state) { }

    private record SentTerrain(ServerLevel level, LinkedHashSet<Long> chunks) { }

    private record DestinationKey(ServerLevel level, List<ChunkPos> chunks) {
        private DestinationKey { chunks = List.copyOf(chunks); }
    }

    private record LoginGuard(
            ServerLevel level,
            ChunkPos chunk,
            CompletableFuture<?> loadFuture,
            LoginSafetyState state) {
        private LoginGuard {
            Objects.requireNonNull(level, "level");
            Objects.requireNonNull(chunk, "chunk");
            Objects.requireNonNull(loadFuture, "loadFuture");
            Objects.requireNonNull(state, "state");
        }
    }

    private record TravelLanding(SavedLocation location, AABB bounds) {
    }

    private record RootMove(
            UUID rootId,
            List<EntityOrigin> memberOrigins,
            SavedLocation landing) {
    }

    private record EntityOrigin(UUID entityId, SavedLocation location) {
    }

    private record RideLink(UUID passengerId, UUID vehicleId) {
    }

    private record LeashLink(UUID leashedId, UUID holderId) {
    }

    private record TravelPlan(
            List<RootMove> moves,
            List<RideLink> rides,
            List<LeashLink> leashes,
            ReturnPoint returnPoint,
            int entityCount) {
    }
}
