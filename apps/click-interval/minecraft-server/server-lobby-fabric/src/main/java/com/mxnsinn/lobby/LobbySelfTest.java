package com.mxnsinn.lobby;

import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.gamerules.GameRules;
import net.minecraft.world.Difficulty;
import com.mojang.authlib.GameProfile;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Relative;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.server.permissions.LevelBasedPermissionSet;
import net.minecraft.world.level.portal.TeleportTransition;
import net.minecraft.world.level.Level;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import java.util.UUID;
import java.util.Set;
import java.nio.file.Files;
import java.nio.file.Path;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.LoggerFactory;

final class LobbySelfTest {
    static void prepareHoldingFixture(MinecraftServer server) {
        requireDisposableFixture(server);
        var settings = LobbyPreviewGuard.settings(server).orElseThrow();
        BlockPos feet = BlockPos.containing(settings.x(), settings.y(), settings.z());
        var world = server.overworld();
        world.getChunk(feet);
        world.setBlock(feet.below(), Blocks.STONE.defaultBlockState(), 3);
        world.setBlock(feet, Blocks.AIR.defaultBlockState(), 3);
        world.setBlock(feet.above(), Blocks.AIR.defaultBlockState(), 3);
    }
    static void runInactive(MinecraftServer server) {
        requireDisposableFixture(server);
        require(!LobbyPreviewGuard.active(server), "invalid candidate stays inactive");
        require(server.overworld().getGameRules().get(GameRules.BLOCK_DROPS), "ordinary gamerules untouched");
        ServerPlayer player = new ServerPlayer(server, server.overworld(), new GameProfile(UUID.randomUUID(), "InactiveLobby"), ClientInformation.createDefault());
        player.connection = new ServerGamePacketListenerImpl(server, new Connection(PacketFlow.SERVERBOUND), player,
                CommonListenerCookie.createInitial(player.getGameProfile(), false)) { @Override public void send(Packet<?> packet) {} };
        player.setPos(300.5, 90, -200.5);
        require(player.setGameMode(GameType.CREATIVE), "ordinary creative mode remains usable");
        LobbyPreviewGuard.protect(player, true);
        require(player.gameMode.getGameModeForPlayer() == GameType.CREATIVE && player.getAbilities().mayfly
                && player.getX() == 300.5 && player.getY() == 90 && player.getZ() == -200.5, "inactive guard changes no mode ability or position");
        LoggerFactory.getLogger("LobbyPreviewGuard").info("LOBBY_PREVIEW_INACTIVE_NATIVE_TEST_PASS");
    }
    static void run(MinecraftServer server) {
        requireDisposableFixture(server);
        if (!LobbyPreviewGuard.active(server)) throw new IllegalStateException("Native tests require a marked lobby fixture");
        var settings = LobbyPreviewGuard.settings(server).orElseThrow();
        var rules = server.overworld().getGameRules();
        require(!rules.get(GameRules.ADVANCE_TIME), "fixed daytime");
        require(!rules.get(GameRules.SPAWN_MOBS), "no mobs");
        require(!rules.get(GameRules.BLOCK_DROPS) && !rules.get(GameRules.ENTITY_DROPS) && !rules.get(GameRules.MOB_DROPS), "no drops");
        require(!rules.get(GameRules.COMMAND_BLOCKS_WORK), "no command blocks");
        require(!rules.get(GameRules.FALL_DAMAGE) && !rules.get(GameRules.FIRE_DAMAGE)
                && !rules.get(GameRules.DROWNING_DAMAGE) && !rules.get(GameRules.FREEZE_DAMAGE), "environmental damage rules disabled too");
        require(server.overworld().getDifficulty() == Difficulty.PEACEFUL, "peaceful");
        ServerPlayer player = new ServerPlayer(server, server.overworld(), new GameProfile(UUID.randomUUID(), "LobbyTest"), ClientInformation.createDefault());
        player.connection = new ServerGamePacketListenerImpl(server, new Connection(PacketFlow.SERVERBOUND), player,
                CommonListenerCookie.createInitial(player.getGameProfile(), false)) {
            @Override public void send(Packet<?> packet) {}
        };
        var world = server.overworld();
        BlockPos pos = BlockPos.containing(settings.x(), settings.y() - 1, settings.z());
        world.getChunk(pos);
        var before = world.getBlockState(pos);
        var aboveBefore = world.getBlockState(pos.above());
        try {
            world.setBlock(pos, Blocks.STONE.defaultBlockState(), 3);
            require(world.getBlockState(pos).is(Blocks.STONE), "console/world build changes remain allowed");
            player.setPos(settings.x(), settings.y(), settings.z());
            LobbyPreviewGuard.protect(player, false);
            require(player.gameMode.getGameModeForPlayer() == GameType.SURVIVAL, "survival policy");
            require(!player.setGameMode(GameType.CREATIVE) && !player.setGameMode(GameType.SPECTATOR), "flight modes cannot be entered");
            player.getAbilities().mayfly = true;
            player.getAbilities().flying = true;
            LobbyPreviewGuard.protect(player, false);
            require(!player.getAbilities().mayfly && !player.getAbilities().flying, "flight abilities revoked");
            require(!player.gameMode.destroyBlock(pos) && world.getBlockState(pos).is(Blocks.STONE), "survival block breaking rejected");
            for (var action : new ServerboundPlayerActionPacket.Action[]{ServerboundPlayerActionPacket.Action.START_DESTROY_BLOCK,
                    ServerboundPlayerActionPacket.Action.STOP_DESTROY_BLOCK, ServerboundPlayerActionPacket.Action.ABORT_DESTROY_BLOCK}) {
                player.gameMode.handleBlockBreakAction(pos, action, Direction.UP, world.getMaxY(), 1);
                require(world.getBlockState(pos).is(Blocks.STONE), "real mining packet action cannot break block: " + action);
            }
            world.setBlock(pos, Blocks.DRAGON_EGG.defaultBlockState(), 3);
            player.gameMode.handleBlockBreakAction(pos, ServerboundPlayerActionPacket.Action.START_DESTROY_BLOCK, Direction.UP, world.getMaxY(), 2);
            require(world.getBlockState(pos).is(Blocks.DRAGON_EGG), "attack interaction cannot teleport a dragon egg before block-break event");
            world.setBlock(pos, Blocks.STONE.defaultBlockState(), 3);
            var stack = new ItemStack(Items.DIRT, 8);
            player.setItemInHand(InteractionHand.MAIN_HAND, stack);
            var hit = new BlockHitResult(Vec3.atCenterOf(pos), Direction.UP, pos, false);
            require(player.gameMode.useItemOn(player, world, stack, InteractionHand.MAIN_HAND, hit) == InteractionResult.FAIL
                    && stack.getCount() == 8 && world.getBlockState(pos.above()).equals(aboveBefore), "placement refused without consuming items");
            require(player.gameMode.useItem(player, world, stack, InteractionHand.MAIN_HAND) == InteractionResult.FAIL, "item use denied");
            float health = player.getHealth();
            for (var source : java.util.List.of(player.damageSources().fall(), player.damageSources().fellOutOfWorld(),
                    player.damageSources().lava(), player.damageSources().inFire(), player.damageSources().onFire(),
                    player.damageSources().drown(), player.damageSources().explosion(null, null),
                    player.damageSources().playerAttack(player), player.damageSources().genericKill(), player.damageSources().magic())) {
                require(!player.hurtServer(world, source, Float.MAX_VALUE) && player.getHealth() == health, "damage source rejected: " + source.getMsgId());
            }
            player.kill(world);
            player.die(player.damageSources().genericKill());
            player.setHealth(0);
            player.setHealth(1);
            player.setHealth(Float.NaN);
            player.remove(Entity.RemovalReason.KILLED);
            require(player.isAlive() && !player.isRemoved() && !player.isDeadOrDying() && player.getHealth() == health,
                    "kill command/direct death/zero or reduced health/killed-removal all rejected");
            var stand = new ArmorStand(world, settings.x() + 1, settings.y(), settings.z());
            float standHealth = stand.getHealth();
            player.attack(stand);
            require(!stand.isRemoved() && stand.getHealth() == standHealth, "actual attack route cannot destroy decorations");
            require(player.interactOn(stand, InteractionHand.MAIN_HAND, Vec3.ZERO) == InteractionResult.FAIL, "actual entity interaction cannot change decorations");
            require(!player.teleportTo(world, settings.maxX() + 100, settings.y(), settings.z(), Set.of(), 0, 0, false), "direct teleport cannot leave bounds");
            require(!player.teleportTo(world, settings.maxX() + 100, 0, 0, Set.of(Relative.X, Relative.Y, Relative.Z), 0, 0, false), "relative teleport cannot leave bounds");
            require(player.teleport(new TeleportTransition(server.getLevel(Level.NETHER), Vec3.ZERO, Vec3.ZERO, 0, 0, TeleportTransition.DO_NOTHING)) == null,
                    "portal/dimension transfer cannot leave lobby");
            var commandPos = player.position();
            server.getCommands().performPrefixedCommand(player.createCommandSourceStack().withPermission(LevelBasedPermissionSet.OWNER), "tp @s 20000 200 20000");
            require(player.position().equals(commandPos), "operator-level player escape command still blocked");
            player.drop(true);
            require(player.getMainHandItem().getCount() == 8, "manual drop preserves inventory");
            player.inventoryMenu.clicked(36, 1, ContainerInput.THROW, player);
            require(player.getMainHandItem().getCount() == 8, "inventory Q drop preserves inventory");
            player.inventoryMenu.setCarried(new ItemStack(Items.DIAMOND, 3));
            player.inventoryMenu.clicked(-999, 0, ContainerInput.PICKUP, player);
            require(player.inventoryMenu.getCarried().getCount() == 3, "outside click preserves carried items");
            require(!world.addFreshEntity(new ItemEntity(world, settings.x(), settings.y(), settings.z(), new ItemStack(Items.DIRT))), "item entity drop blocked");
            var mob = EntityTypes.COW.create(world, EntitySpawnReason.COMMAND);
            require(mob != null && !world.addFreshEntity(mob), "passive mob spawn blocked");
            for (var type : java.util.List.of(EntityTypes.EXPERIENCE_ORB, EntityTypes.TNT, EntityTypes.ARROW, EntityTypes.AREA_EFFECT_CLOUD)) {
                var entity = type.create(world, EntitySpawnReason.COMMAND);
                require(entity != null && !world.addFreshEntity(entity), "XP/TNT/projectile/cloud spawn blocked: " + type);
            }
            player.setPos(settings.x(), settings.minY() - 10, settings.z());
            LobbyPreviewGuard.protect(player, false);
            require(player.getY() == settings.y() && player.getX() == settings.x() && player.getZ() == settings.z(), "void rescue returns to configured lobby spawn");
            player.setPos(settings.maxX() + 1, settings.y(), settings.z());
            LobbyPreviewGuard.protect(player, false);
            require(player.getX() == settings.x(), "configured bounds rescue returns to lobby spawn");
            if (LobbyPreviewGuard.holding(server)) {
                player.addEffect(new MobEffectInstance(MobEffects.LEVITATION, 100));
                player.setExperienceLevels(10);
                player.getAbilities().mayfly = true;
                player.getAbilities().flying = true;
                LobbyPreviewGuard.resetHoldingPlayer(player);
                LobbyPreviewGuard.protect(player, true);
                require(player.getInventory().isEmpty() && player.inventoryMenu.getCarried().isEmpty()
                        && player.experienceLevel == 0 && player.getActiveEffects().isEmpty() && !player.getAbilities().mayfly && !player.getAbilities().flying,
                        "holding arrivals reset stale inventory cursor XP effects and flight only inside holding world");
            } else {
                LobbyPreviewGuard.resetHoldingPlayer(player);
                require(player.getMainHandItem().getCount() == 8, "candidate inventory is never cleared by holding reset");
            }
            player.remove(Entity.RemovalReason.DISCARDED);
            require(player.isRemoved(), "normal disconnect/removal path remains allowed");
        } finally { world.setBlock(pos, before, 3); }
        LoggerFactory.getLogger("LobbyPreviewGuard").info("LOBBY_PREVIEW_NATIVE_TEST_PASS: rules, survival, noflight, real mining/attack packets, no build/drop, all damage/kill/death immunity, command and teleport escape denial, safe reset/rescue, normal logout.");
    }
    private static void require(boolean value, String label) { if (!value) throw new IllegalStateException("Lobby test failed: " + label); }
    private static void requireDisposableFixture(MinecraftServer server) {
        try {
            Path root = server.getWorldPath(LevelResource.ROOT).toRealPath();
            Path allowed = Path.of("D:/Codex-Projects/OPMouseHotkeyElectron/minecraft-server/server-lobby-fabric/build/native-fixtures").toRealPath();
            require(root.startsWith(allowed) && Files.readString(root.resolve(".lobby-guard-disposable-test"))
                    .equals("Lobby Guard disposable native fixture v1\n"), "tests require an explicitly marked project-only disposable fixture");
        } catch (java.io.IOException failure) { throw new IllegalStateException("Missing disposable fixture authorization marker", failure); }
    }
}
