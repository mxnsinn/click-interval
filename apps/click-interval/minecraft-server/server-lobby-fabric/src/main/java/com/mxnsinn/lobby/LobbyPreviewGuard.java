package com.mxnsinn.lobby;

import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.Optional;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.fabricmc.fabric.api.event.player.UseItemCallback;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Difficulty;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.item.PrimedTnt;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.entity.AreaEffectCloud;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.gamerules.GameRules;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.Vec3;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.storage.LevelData;
import org.slf4j.LoggerFactory;

public final class LobbyPreviewGuard implements ModInitializer {
    private static final Map<MinecraftServer, Optional<LobbyScope.Profile>> ACTIVE = Collections.synchronizedMap(new WeakHashMap<>());
    private static Optional<LobbyScope.Profile> profile(MinecraftServer server) {
        if (server == null) return Optional.empty();
        return ACTIVE.computeIfAbsent(server, s -> LobbyScope.profile(s.getWorldPath(LevelResource.ROOT), s.isDedicatedServer()));
    }
    static Optional<LobbySettings> settings(MinecraftServer server) {
        return profile(server).map(LobbyScope.Profile::settings);
    }
    public static boolean active(MinecraftServer server) {
        return profile(server).isPresent();
    }
    public static boolean holding(MinecraftServer server) { return profile(server).map(LobbyScope.Profile::holding).orElse(false); }
    public static boolean active(Level level) { return level != null && !level.isClientSide() && active(level.getServer()); }
    public static boolean prohibitedEntity(Entity entity) {
        return entity instanceof Mob || entity instanceof ItemEntity || entity instanceof ExperienceOrb || entity instanceof Projectile
                || entity instanceof PrimedTnt || entity instanceof FallingBlockEntity || entity instanceof AreaEffectCloud;
    }
    @Override public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTING.register(server -> {
            boolean enabled = active(server);
            if (!enabled && server.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize().getFileName().toString().startsWith("LobbyCandidate-")) {
                LoggerFactory.getLogger("LobbyPreviewGuard").warn("LOBBY_CANDIDATE_GUARD_REFUSED: candidate marker or settings invalid; protection is not active.");
            }
        });
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            if (Boolean.getBoolean("mxnsinn.lobby.selftest.inactive")) LobbySelfTest.runInactive(server);
            if (!active(server)) return;
            configure(server);
            if (holding(server) && Boolean.getBoolean("mxnsinn.lobby.selftest")) LobbySelfTest.prepareHoldingFixture(server);
            if (holding(server)) {
                verifyHoldingSpawn(server);
                LoggerFactory.getLogger("LobbyGuard").info("[LobbyGuard] Holding lobby active: HoldingLobby");
            }
            LoggerFactory.getLogger("LobbyPreviewGuard").info("LOBBY_PREVIEW_GUARD_ACTIVE: marked preview only; survival, protected, peaceful, fixed daytime.");
            if (Boolean.getBoolean("mxnsinn.lobby.selftest")) LobbySelfTest.run(server);
        });
        ServerLifecycleEvents.SERVER_STOPPED.register(ACTIVE::remove);
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            if (holding(server)) resetHoldingPlayer(handler.getPlayer());
            if (active(server)) protect(handler.getPlayer(), true);
        });
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            if (holding(server)) resetHoldingPlayer(handler.getPlayer());
        });
        ServerTickEvents.START_SERVER_TICK.register(server -> {
            if (!active(server)) return;
            for (ServerPlayer player : server.getPlayerList().getPlayers()) protect(player, false);
            if (server.getTickCount() % 1200 == 0) configure(server);
        });
        ServerEntityEvents.ENTITY_LOAD.register((entity, world) -> {
            if (active(world) && prohibitedEntity(entity)) entity.discard();
        });
        ServerLivingEntityEvents.ALLOW_DAMAGE.register((entity, source, amount) -> !active(entity.level()));
        PlayerBlockBreakEvents.BEFORE.register((world, player, pos, state, blockEntity) -> !active(world));
        UseBlockCallback.EVENT.register((player, world, hand, hit) -> active(world) ? InteractionResult.FAIL : InteractionResult.PASS);
        UseItemCallback.EVENT.register((player, world, hand) -> active(world) ? InteractionResult.FAIL : InteractionResult.PASS);
        UseEntityCallback.EVENT.register((player, world, hand, entity, hit) -> active(world) ? InteractionResult.FAIL : InteractionResult.PASS);
        AttackEntityCallback.EVENT.register((player, world, hand, entity, hit) -> active(world) ? InteractionResult.FAIL : InteractionResult.PASS);
    }
    static void configure(MinecraftServer server) {
        server.setDefaultGameType(GameType.SURVIVAL);
        server.setDifficulty(Difficulty.PEACEFUL, true);
        server.setDifficultyLocked(true);
        var rules = server.overworld().getGameRules();
        for (var rule : java.util.List.of(GameRules.ADVANCE_TIME, GameRules.ADVANCE_WEATHER,
                GameRules.BLOCK_DROPS, GameRules.ENTITY_DROPS, GameRules.MOB_DROPS, GameRules.MOB_GRIEFING,
                GameRules.SPAWN_MOBS, GameRules.SPAWN_MONSTERS, GameRules.SPAWN_PATROLS, GameRules.SPAWN_PHANTOMS,
                GameRules.SPAWN_WANDERING_TRADERS, GameRules.SPAWN_WARDENS, GameRules.SPAWNER_BLOCKS_WORK,
                GameRules.COMMAND_BLOCKS_WORK, GameRules.PVP, GameRules.TNT_EXPLODES, GameRules.RAIDS,
                GameRules.FALL_DAMAGE, GameRules.FIRE_DAMAGE, GameRules.DROWNING_DAMAGE, GameRules.FREEZE_DAMAGE,
                GameRules.ALLOW_ENTERING_NETHER_USING_PORTALS, GameRules.PROJECTILES_CAN_BREAK_BLOCKS)) rules.set(rule, false, server);
        rules.set(GameRules.KEEP_INVENTORY, true, server);
        rules.set(GameRules.FIRE_SPREAD_RADIUS_AROUND_PLAYER, 0, server);
        rules.set(GameRules.RANDOM_TICK_SPEED, 0, server);
        rules.set(GameRules.RESPAWN_RADIUS, 0, server);
        server.setWeatherParameters(1_000_000, 0, false, false);
        server.getCommands().performPrefixedCommand(server.createCommandSourceStack().withSuppressedOutput(), "time set 6000");
        LobbySettings settings = settings(server).orElseThrow();
        server.overworld().setRespawnData(LevelData.RespawnData.of(Level.OVERWORLD, BlockPos.containing(settings.x(), settings.y(), settings.z()), settings.yaw(), settings.pitch()));
    }
    private static void verifyHoldingSpawn(MinecraftServer server) {
        LobbySettings settings = settings(server).orElseThrow();
        var world = server.overworld();
        BlockPos feet = BlockPos.containing(settings.x(), settings.y(), settings.z()), floor = feet.below();
        world.getChunk(feet); // One bounded spawn chunk, before readiness is announced.
        if (!world.getBlockState(floor).isFaceSturdy(world, floor, Direction.UP)
                || !world.getBlockState(feet).getCollisionShape(world, feet).isEmpty()
                || !world.getBlockState(feet.above()).getCollisionShape(world, feet.above()).isEmpty()
                || !world.getFluidState(feet).isEmpty() || !world.getFluidState(feet.above()).isEmpty()) {
            throw new IllegalStateException("HOLDING_LOBBY_UNSAFE: configured spawn needs a solid floor and two clear dry blocks; refusing readiness");
        }
    }
    static void resetHoldingPlayer(ServerPlayer player) {
        if (!holding(player.level().getServer())) return;
        player.closeContainer();
        player.getInventory().clearContent();
        player.inventoryMenu.setCarried(ItemStack.EMPTY);
        player.containerMenu.setCarried(ItemStack.EMPTY);
        player.setExperiencePoints(0);
        player.setExperienceLevels(0);
        player.totalExperience = 0;
        player.removeAllEffects();
        player.clearFire();
        player.deathTime = 0;
        player.fallDistance = 0;
        player.stopRiding();
        player.stopFallFlying();
        player.setDeltaMovement(Vec3.ZERO);
        player.containerMenu.sendAllDataToRemote();
    }
    public static boolean deniedTeleport(ServerPlayer player, net.minecraft.server.level.ServerLevel destination, double x, double y, double z) {
        LobbySettings settings = settings(player.level().getServer()).orElse(null);
        return settings != null && (destination == null || !destination.dimension().equals(Level.OVERWORLD) || settings.outside(x, y, z));
    }
    static void protect(ServerPlayer player, boolean arrived) {
        LobbySettings settings = settings(player.level().getServer()).orElse(null);
        if (settings == null) return;
        if (player.gameMode.getGameModeForPlayer() != GameType.SURVIVAL) player.setGameMode(GameType.SURVIVAL);
        var abilities = player.getAbilities();
        if (abilities.mayfly || abilities.flying) { abilities.mayfly = false; abilities.flying = false; player.onUpdateAbilities(); }
        player.fallDistance = 0;
        player.deathTime = 0;
        if (player.isFallFlying()) player.stopFallFlying();
        player.clearFire();
        if (player.getHealth() < player.getMaxHealth()) player.setHealth(player.getMaxHealth());
        player.getFoodData().setFoodLevel(20);
        player.getFoodData().setSaturation(5);
        if (arrived || !player.level().dimension().equals(Level.OVERWORLD)
                || settings.outside(player.getX(), player.getY(), player.getZ())) {
            player.setDeltaMovement(Vec3.ZERO);
            player.teleportTo(player.level().getServer().overworld(), settings.x(), settings.y(), settings.z(), Set.of(), settings.yaw(), settings.pitch(), false);
        }
    }
}
