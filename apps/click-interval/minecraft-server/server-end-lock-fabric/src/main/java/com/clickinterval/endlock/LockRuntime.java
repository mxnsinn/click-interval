package com.clickinterval.endlock;

import com.clickinterval.endlock.mixin.ServerPlayerOriginAccessor;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.portal.TeleportTransition;
import net.minecraft.world.phys.Vec3;
import java.io.IOException;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import static com.clickinterval.endlock.EndLockState.Domain.NETHER;

/** Per-world bounded server-thread work; no network callbacks or asynchronous world mutation. */
final class LockRuntime {
    private final NetherOriginStore origins;
    private final Map<UUID, Long> lastNotice = new HashMap<>();
    private final Map<UUID, Long> nextAttempt = new HashMap<>();
    private final Set<UUID> invalidOrigins = new HashSet<>();
    private final Map<UUID, Long> arrivalGrace = new HashMap<>();
    private final Set<UUID> failedOriginLoads = new HashSet<>();
    private CompletableFuture<?> originLoad;
    private ChunkPos originTicketChunk;
    private UUID originLoadPlayer;
    private long originLoadDeadline;
    private int cursor;
    private long nextStateRefresh;
    private CompletableFuture<?> spawnLoad;
    private ChunkPos spawnTicketChunk;
    private long spawnLoadDeadline;
    private long nextSpawnLoad;

    LockRuntime(Path directory) { origins = new NetherOriginStore(directory); }

    void tick(MinecraftServer server) {
        long now = System.currentTimeMillis();
        EndLockState state = ServerEndLock.state(server);
        if (now >= nextStateRefresh || now + 2000 < nextStateRefresh) {
            nextStateRefresh = now + 1000;
            if (state.refresh(now)) ServerEndLock.refreshMenus(server);
        }
        var players = server.getPlayerList().getPlayers();
        arrivalGrace.values().removeIf(deadline -> now >= deadline);
        for (ServerPlayer player : players) {
            if (player.level().dimension().equals(Level.NETHER) && state.locked(NETHER, now)) {
                player.resetFallDistance();
                player.clearFire();
                player.setDeltaMovement(Vec3.ZERO);
            }
        }
        if (!state.locked(NETHER, now) || players.stream().noneMatch(player -> player.level().dimension().equals(Level.NETHER))) {
            releaseSpawn(server);
            releaseOrigin(server);
            nextAttempt.clear();
            return;
        }
        if (originLoad != null && (now >= originLoadDeadline || originLoad.isCompletedExceptionally())) {
            failedOriginLoads.add(originLoadPlayer);
            releaseOrigin(server);
        }
        if (spawnLoad != null && (now >= spawnLoadDeadline || spawnLoad.isCompletedExceptionally())) {
            releaseSpawn(server);
            nextSpawnLoad = now + 30_000;
        }
        // At most one landing search/teleport per tick and 16 scanned player entries.
        for (int scanned = 0; scanned < Math.min(16, players.size()); scanned++) {
            ServerPlayer player = players.get(Math.floorMod(cursor++, players.size()));
            if (!player.isAlive() || !player.level().dimension().equals(Level.NETHER)
                    || now < nextAttempt.getOrDefault(player.getUUID(), 0L)) continue;
            nextAttempt.put(player.getUUID(), now + 1000);
            evacuate(server, player, now);
            break;
        }
    }

    void joined(ServerPlayer player) { nextAttempt.remove(player.getUUID()); failedOriginLoads.remove(player.getUUID()); }
    boolean arrivalProtected(ServerPlayer player) { return System.currentTimeMillis() < arrivalGrace.getOrDefault(player.getUUID(), 0L); }
    void disconnected(MinecraftServer server, ServerPlayer player) {
        lastNotice.remove(player.getUUID());
        nextAttempt.remove(player.getUUID());
        arrivalGrace.remove(player.getUUID());
        failedOriginLoads.remove(player.getUUID());
        if (player.getUUID().equals(originLoadPlayer)) releaseOrigin(server);
        if (server.getPlayerList().getPlayers().stream().noneMatch(other -> other != player && other.level().dimension().equals(Level.NETHER))) releaseSpawn(server);
    }

    void remember(ServerPlayer player, NetherOriginStore.Origin origin) {
        try { origins.write(player.getUUID(), origin); invalidOrigins.remove(player.getUUID()); }
        catch (IOException failure) {
            invalidOrigins.add(player.getUUID());
            try { origins.invalidate(player.getUUID()); }
            catch (IOException cleanupFailure) {
                ServerEndLock.LOGGER.error("Could not invalidate old Nether origin for {}; current session ignores it, but repair storage before restart", player.getUUID(), cleanupFailure);
            }
            ServerEndLock.LOGGER.warn("Could not remember Nether entry for {}; safe spawn fallback will be used if needed", player.getUUID(), failure);
        }
    }

    void notice(ServerPlayer player, EndLockState.Domain domain, String suffix) {
        long now = System.currentTimeMillis();
        Long previous = lastNotice.get(player.getUUID());
        if (previous != null && now >= previous && now - previous < 3000) return;
        lastNotice.put(player.getUUID(), now);
        player.sendSystemMessage(Component.literal(ServerEndLock.lockMessage(ServerEndLock.state(player.level().getServer()), domain, now)
                + (suffix == null ? "" : " " + suffix)));
    }

    boolean evacuate(MinecraftServer server, ServerPlayer player, long now) {
        if (!player.isAlive() || !player.level().dimension().equals(Level.NETHER) || !ServerEndLock.state(server).locked(NETHER, now)) return false;
        ServerLevel destination = null;
        Vec3 landing = null;
        float yaw = player.getYRot(), pitch = player.getXRot();
        boolean fallback = true;
        try {
            var remembered = java.util.Optional.<NetherOriginStore.Origin>empty();
            if (!invalidOrigins.contains(player.getUUID())) {
                try { remembered = origins.read(player.getUUID()); }
                catch (IOException invalidHistory) { /* Vanilla's independently persisted origin can still recover this trip. */ }
            }
            // Vanilla persists this exact Overworld pre-entry position even before this mod was installed.
            // Never derive a player's portal from their current Nether coordinates or another player's record.
            if (remembered.isEmpty()) {
                Vec3 vanilla = ((ServerPlayerOriginAccessor) player).serverEndLock$getEnteredNetherPosition();
                if (vanilla != null) remembered = java.util.Optional.of(new NetherOriginStore.Origin("minecraft:overworld",
                        vanilla.x, vanilla.y, vanilla.z, yaw, pitch));
            }
            if (remembered.isPresent()) {
                var origin = remembered.get();
                ServerLevel prior = server.getLevel(ResourceKey.create(Registries.DIMENSION, Identifier.parse(origin.dimension())));
                if (prior != null && prior.dimension().equals(Level.OVERWORLD)) {
                    landing = EvacuationSafety.nearOrigin(prior, player, new Vec3(origin.x(), origin.y(), origin.z()));
                    if (landing == null && !EvacuationSafety.originNeighborhoodLoaded(prior, new Vec3(origin.x(), origin.y(), origin.z()))
                            && !failedOriginLoads.contains(player.getUUID())) {
                        prepareOrigin(server, player, origin, now);
                        notice(player, NETHER, "Preparing a safe return beside your Overworld portal; you are protected while waiting.");
                        return false;
                    }
                    if (landing != null) { destination = prior; yaw = origin.yaw(); pitch = origin.pitch(); fallback = false; }
                }
            }
        } catch (IllegalArgumentException invalid) {
            // Malformed, missing, stale or unavailable historical data never becomes a guessed teleport.
        }
        if (landing == null) {
            destination = server.overworld();
            var spawn = destination.getRespawnData();
            if (!spawn.dimension().equals(Level.OVERWORLD)) {
                notice(player, NETHER, "Cannot find a verified Overworld spawn; you have not been moved.");
                return false;
            }
            landing = EvacuationSafety.nearSpawn(destination, player, spawn.pos());
            if (landing == null) {
                prepareSpawn(server, spawn.pos(), now);
                notice(player, NETHER, "Waiting for a verified safe Overworld spawn; you have not been moved.");
                return false;
            }
            yaw = spawn.yaw(); pitch = spawn.pitch();
        }
        if (!EvacuationSafety.safe(destination, player, landing)) return false;
        // Preserve current health/inventory/game mode; no potion or persistent invulnerability flag is modified.
        arrivalGrace.put(player.getUUID(), now + 5000);
        player.stopRiding();
        // Only this player is evacuated. Vehicles, inventories, pets and portal blocks are not deleted.
        ServerPlayer moved = player.teleport(new TeleportTransition(destination, landing, Vec3.ZERO, yaw, pitch, TeleportTransition.DO_NOTHING));
        if (moved == null || player.level() != destination) { arrivalGrace.remove(player.getUUID()); return false; }
        player.resetFallDistance();
        player.setDeltaMovement(Vec3.ZERO);
        player.clearFire();
        player.setPortalCooldown();
        nextAttempt.remove(player.getUUID());
        if (player.getUUID().equals(originLoadPlayer)) releaseOrigin(server);
        player.sendSystemMessage(Component.literal(ServerEndLock.lockMessage(ServerEndLock.state(server), NETHER, now)
                + (fallback ? " Returned to safe Overworld spawn (prior entry unknown, unavailable or unsafe)."
                : " Returned safely to your prior Nether entry location.")));
        return true;
    }

    private void prepareSpawn(MinecraftServer server, BlockPos spawn, long now) {
        if (spawnLoad != null || now < nextSpawnLoad) return;
        spawnTicketChunk = ChunkPos.containing(spawn);
        spawnLoadDeadline = now + 10_000;
        nextSpawnLoad = now + 30_000;
        // A single known spawn neighborhood only. Never request an arbitrary recorded/distant origin.
        spawnLoad = server.overworld().getChunkSource().addTicketAndLoadWithRadius(ServerEndLock.evacuationTicket, spawnTicketChunk, 1);
    }

    private void prepareOrigin(MinecraftServer server, ServerPlayer player, NetherOriginStore.Origin origin, long now) {
        if (originLoad != null) return; // Serialize known-origin loading: at most one 3x3 neighborhood, not one per player.
        originLoadPlayer = player.getUUID();
        originTicketChunk = ChunkPos.containing(BlockPos.containing(origin.x(), origin.y(), origin.z()));
        originLoadDeadline = now + 10_000;
        originLoad = server.overworld().getChunkSource().addTicketAndLoadWithRadius(ServerEndLock.originEvacuationTicket, originTicketChunk, 1);
    }

    private void releaseOrigin(MinecraftServer server) {
        if (originTicketChunk != null) server.overworld().getChunkSource().removeTicketWithRadius(ServerEndLock.originEvacuationTicket, originTicketChunk, 1);
        originTicketChunk = null;
        originLoadPlayer = null;
        originLoad = null;
    }

    private void releaseSpawn(MinecraftServer server) {
        if (spawnTicketChunk != null) server.overworld().getChunkSource().removeTicketWithRadius(ServerEndLock.evacuationTicket, spawnTicketChunk, 1);
        spawnTicketChunk = null;
        spawnLoad = null;
    }

    void close(MinecraftServer server) {
        releaseSpawn(server); releaseOrigin(server); lastNotice.clear(); nextAttempt.clear(); arrivalGrace.clear(); failedOriginLoads.clear();
    }
}
