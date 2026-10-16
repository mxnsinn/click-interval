package com.clickinterval.endlock;

import com.clickinterval.endlock.mixin.CrafterAccessor;
import com.mojang.authlib.GameProfile;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.server.permissions.LevelBasedPermissionSet;
import net.minecraft.server.rcon.RconConsoleSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.ResultSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.CrafterBlock;
import net.minecraft.world.level.block.EndPortalBlock;
import net.minecraft.world.level.block.EndPortalFrameBlock;
import net.minecraft.world.level.block.entity.CrafterBlockEntity;
import net.minecraft.world.level.portal.TeleportTransition;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Invoked only with both the dedicated JVM flag and disposable-world marker. */
final class EndLockSelfTest {
    static void run(MinecraftServer server) {
        EndLockState state = ServerEndLock.state(server);
        boolean prior = state.locked();
        try {
            state.setLocked(true);
            ServerLevel level = server.overworld();
            ServerLevel end = server.getLevel(Level.END);
            require(end != null, "End dimension is available");
            GameProfile profile = new GameProfile(UUID.nameUUIDFromBytes("EndLockFixture".getBytes(java.nio.charset.StandardCharsets.UTF_8)), "EndLockFixture");
            ServerPlayer player = new ServerPlayer(server, level, profile, ClientInformation.createDefault());
            player.connection = new ServerGamePacketListenerImpl(server, new Connection(PacketFlow.SERVERBOUND), player, CommonListenerCookie.createInitial(profile, false));
            require(ServerEndLock.consoleOnly(server.createCommandSourceStack()), "console may toggle");
            require(ServerEndLock.consoleOnly(new RconConsoleSource(server).createCommandSourceStack()), "authenticated RCON may toggle");
            require(!ServerEndLock.consoleOnly(player.createCommandSourceStack()), "player cannot toggle");
            require(ServerEndLock.canManage(server.createCommandSourceStack()), "console remains authorized by management guard");
            require(ServerEndLock.canManage(new RconConsoleSource(server).createCommandSourceStack()), "RCON remains authorized by management guard");
            require(!ServerEndLock.canManage(player.createCommandSourceStack().withPermission(LevelBasedPermissionSet.OWNER)),
                    "elevated dedicated player cannot manage End state");
            require(!ServerEndLock.canManage(player.createCommandSourceStack().withSource(net.minecraft.commands.CommandSource.NULL)
                    .withPermission(LevelBasedPermissionSet.OWNER)), "non-player command source cannot impersonate host");
            require(!ServerEndLock.consoleOnly(player.createCommandSourceStack().withEntity(
                    new ItemEntity(level, 48, 96, 48, new ItemStack(Items.STONE)))), "player execute context cannot masquerade as console");

            CraftingInput input = CraftingInput.of(2, 1, List.of(new ItemStack(Items.ENDER_PEARL), new ItemStack(Items.BLAZE_POWDER)));
            require(server.getRecipeManager().getRecipeFor(RecipeType.CRAFTING, input, level).isEmpty(), "locked recipe lookup has no eye output");
            CraftingInput vertical = CraftingInput.of(1, 2, List.of(new ItemStack(Items.ENDER_PEARL), new ItemStack(Items.BLAZE_POWDER)));
            require(CrafterBlock.getPotentialResults(level, vertical).isEmpty(), "first crafter use during lock returns no output");
            CraftingInput ordinary = CraftingInput.of(1, 1, List.of(new ItemStack(Items.OAK_LOG)));
            require(server.getRecipeManager().getRecipeFor(RecipeType.CRAFTING, ordinary, level).isPresent(), "ordinary crafting is unchanged");
            state.setLocked(false);
            require(CrafterBlock.getPotentialResults(level, vertical).isPresent(), "unlock recovers previously denied grid without stale negative cache");
            var cached = server.getRecipeManager().getRecipeFor(RecipeType.CRAFTING, input, level).orElseThrow();
            require(cached.value().assemble(input).is(Items.ENDER_EYE), "unlock restores eye recipe");
            require(CrafterBlock.getPotentialResults(level, input).isPresent(), "prime vanilla crafter recipe cache");
            state.setLocked(true);
            require(server.getRecipeManager().getRecipeFor(RecipeType.CRAFTING, input, level, cached).isEmpty(), "cached preferred recipe cannot bypass lock");
            require(CrafterBlock.getPotentialResults(level, input).isEmpty(), "warmed crafter cache cannot bypass relock");

            player.inventoryMenu.getSlot(1).set(new ItemStack(Items.ENDER_PEARL, 8));
            player.inventoryMenu.getSlot(2).set(new ItemStack(Items.BLAZE_POWDER, 8));
            player.inventoryMenu.getSlot(0).set(new ItemStack(Items.ENDER_EYE)); // stale preview from before relock
            ResultSlot output = (ResultSlot) player.inventoryMenu.getSlot(0);
            require(!output.mayPickup(player), "stale result pickup blocked");
            require(output.remove(1).isEmpty(), "stale result removal blocked before ingredients consumed");
            require(output.safeClone(player).isEmpty(), "stale creative clone blocked");
            require(player.inventoryMenu.quickMoveStack(player, 0).isEmpty(), "stale inventory shift-click blocked");
            CraftingMenu table = new CraftingMenu(99, player.getInventory());
            table.getSlot(0).set(new ItemStack(Items.ENDER_EYE));
            require(table.quickMoveStack(player, 0).isEmpty(), "stale table shift-click blocked");
            require(player.inventoryMenu.getSlot(1).getItem().getCount() == 8
                    && player.inventoryMenu.getSlot(2).getItem().getCount() == 8, "blocked stale crafts preserve both ingredients");
            crafter(level, state);
            frame(level, player, state);

            ItemEntity item = new ItemEntity(level, 48, 96, 48, new ItemStack(Items.ENDER_EYE, 7));
            var destination = new TeleportTransition(end, new Vec3(48, 96, 48), Vec3.ZERO, 0, 0, TeleportTransition.DO_NOTHING);
            require(item.teleport(destination) == null && !item.isRemoved() && item.getItem().getCount() == 7, "incoming entity transfer denied without destruction");
            require(player.teleport(destination) == null && player.level() == level, "player transition/TPA denied");
            require(!player.teleportTo(end, 48, 96, 48, Set.of(), 0, 0, false), "command teleport reports failure rather than bypassing lock");
            require(((EndPortalBlock) Blocks.END_PORTAL).getPortalDestination(level, item, item.blockPosition()) == null, "existing portal blocked before arrival-platform side effects");
            ItemEntity alreadyInside = new ItemEntity(end, 48, 96, 48, new ItemStack(Items.ENDER_EYE, 7));
            require(!ServerEndLock.blocksEntry(alreadyInside, level), "exiting End allowed");
            require(!ServerEndLock.blocksEntry(alreadyInside, end), "movement within End allowed");
            require(!ServerEndLock.blocksEntry(item, level), "ordinary same-world pearl/teleport unaffected");
            state.setLocked(false);
            require(!ServerEndLock.blocksEntry(item, end), "unlock restores incoming travel");
            require(new EndLockState(server.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT)
                    .resolve("server-end-lock/state.properties")).locked() == false, "unlock persists across reload");
            item.discard();
            alreadyInside.discard();
            ServerEndLock.LOGGER.info("SERVER_END_LOCK_NATIVE_TEST_PASS");
        } catch (Exception failure) {
            throw new IllegalStateException("End lock native selftest failed", failure);
        } finally {
            try { state.setLocked(prior); } catch (java.io.IOException failure) { throw new IllegalStateException("Cannot restore fixture End state", failure); }
        }
    }

    private static void frame(ServerLevel level, ServerPlayer player, EndLockState state) throws java.io.IOException {
        BlockPos pos = new BlockPos(48, 96, 52);
        level.getChunk(pos);
        var before = level.getBlockState(pos);
        try {
            level.setBlock(pos, Blocks.END_PORTAL_FRAME.defaultBlockState().setValue(EndPortalFrameBlock.HAS_EYE, false), 3);
            player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(Items.ENDER_EYE, 7));
            UseOnContext context = new UseOnContext(player, InteractionHand.MAIN_HAND,
                    new BlockHitResult(Vec3.atCenterOf(pos), Direction.UP, pos, false));
            require(Items.ENDER_EYE.useOn(context) == InteractionResult.FAIL, "frame insertion denied");
            require(!level.getBlockState(pos).getValue(EndPortalFrameBlock.HAS_EYE)
                    && player.getItemInHand(InteractionHand.MAIN_HAND).getCount() == 7, "locked frame and held eyes unchanged");
            state.setLocked(false);
            Items.ENDER_EYE.useOn(context);
            require(level.getBlockState(pos).getValue(EndPortalFrameBlock.HAS_EYE)
                    && player.getItemInHand(InteractionHand.MAIN_HAND).getCount() == 6, "unlock restores insertion exactly once");
        } finally {
            state.setLocked(true);
            level.setBlock(pos, before, 3);
        }
    }

    private static void crafter(ServerLevel level, EndLockState state) throws java.io.IOException {
        BlockPos pos = new BlockPos(48, 96, 56);
        level.getChunk(pos);
        var before = level.getBlockState(pos);
        try {
            level.setBlock(pos, Blocks.CRAFTER.defaultBlockState(), 3);
            CrafterBlockEntity block = (CrafterBlockEntity) level.getBlockEntity(pos);
            block.setItem(0, new ItemStack(Items.ENDER_PEARL, 8));
            block.setItem(1, new ItemStack(Items.BLAZE_POWDER, 8));
            ((CrafterAccessor) Blocks.CRAFTER).serverEndLock$dispense(level.getBlockState(pos), level, pos);
            require(block.getItem(0).getCount() == 8 && block.getItem(1).getCount() == 8, "locked redstone crafter consumes no ingredients");
            state.setLocked(false);
            ((CrafterAccessor) Blocks.CRAFTER).serverEndLock$dispense(level.getBlockState(pos), level, pos);
            require(block.getItem(0).getCount() == 7 && block.getItem(1).getCount() == 7, "unlocked crafter consumes exactly one ingredient pair");
            int eyes = level.getEntitiesOfClass(ItemEntity.class, new AABB(pos).inflate(3)).stream()
                    .filter(entity -> entity.getItem().is(Items.ENDER_EYE)).mapToInt(entity -> entity.getItem().getCount()).sum();
            require(eyes == 1, "unlocked crafter emits exactly one eye");
            state.setLocked(true);
            ((CrafterAccessor) Blocks.CRAFTER).serverEndLock$dispense(level.getBlockState(pos), level, pos);
            require(block.getItem(0).getCount() == 7 && block.getItem(1).getCount() == 7, "relocked warmed crafter consumes nothing");
        } finally {
            state.setLocked(true);
            level.getEntitiesOfClass(ItemEntity.class, new AABB(pos).inflate(3)).forEach(ItemEntity::discard);
            level.setBlock(pos, before, 3);
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
        ServerEndLock.LOGGER.info("END_LOCK_TEST: {}", message);
    }
}
