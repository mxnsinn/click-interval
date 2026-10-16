package dev.serverenchantments.fabric;

import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.CropBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;

/** Native crop harvesting and guarded enchantment replanting. No synthetic loot or item swaps. */
final class CropHarvest {
    private CropHarvest() { }

    static boolean isRipe(BlockState state) {
        return plantingItem(state) != null && state.getBlock() instanceof CropBlock crop && crop.isMaxAge(state);
    }

    static Item plantingItem(BlockState crop) {
        if (crop.is(Blocks.WHEAT)) return Items.WHEAT_SEEDS;
        if (crop.is(Blocks.CARROTS)) return Items.CARROT;
        if (crop.is(Blocks.POTATOES)) return Items.POTATO;
        if (crop.is(Blocks.BEETROOTS)) return Items.BEETROOT_SEEDS;
        return null;
    }

    static boolean replant(ServerPlayer player, ServerLevel level, BlockPos position, BlockState harvestedCrop) {
        Item item = plantingItem(harvestedCrop);
        if (item == null || !isRipe(harvestedCrop) || player.level() != level || !player.isAlive()
                || player.isRemoved() || !player.mayBuild() || player.isCreative() || player.isSpectator()
                || !level.hasChunkAt(position) || !level.hasChunkAt(position.below())
                || !level.getWorldBorder().isWithinBounds(position) || !level.getWorldBorder().isWithinBounds(position.below())
                || !level.getBlockState(position).isAir() || !level.mayInteract(player, position)
                || !level.mayInteract(player, position.below())
                || player.blockActionRestricted(level, position, player.gameMode.getGameModeForPlayer())) return false;

        // Only inventory items count. Newly spawned crop drops remain normal world drops.
        var inventory = player.getInventory();
        ItemStack heldTool = player.getMainHandItem();
        for (int slot = 0; slot < inventory.getContainerSize(); slot++) {
            ItemStack seed = inventory.getItem(slot);
            if (!seed.is(item) || seed.isEmpty() || !(seed.getItem() instanceof BlockItem blockItem)
                    || blockItem.getBlock() != harvestedCrop.getBlock()) continue;
            if (!player.mayUseItemAt(position, Direction.UP, seed) || player.getCooldowns().isOnCooldown(seed)
                    || !blockItem.getBlock().isEnabled(level.enabledFeatures())) return false;
            BlockHitResult hit = new BlockHitResult(Vec3.atBottomCenterOf(position), Direction.UP, position.below(), false);
            // Native block placement does not dispatch this callback by itself. Honor protection
            // listeners first; even an already-handled SUCCESS must not produce a second placement.
            if (UseBlockCallback.EVENT.invoker().interact(player, level, InteractionHand.MAIN_HAND, hit) != InteractionResult.PASS)
                return false;
            if (inventory.getItem(slot) != seed || seed.isEmpty() || !seed.is(item)
                    || !level.getBlockState(position).isAir() || player.getMainHandItem() != heldTool
                    || player.level() != level || !player.isAlive() || player.isRemoved() || !player.mayBuild()
                    || player.isCreative() || player.isSpectator() || player.isShiftKeyDown()
                    || !level.mayInteract(player, position) || !level.mayInteract(player, position.below())
                    || !player.mayUseItemAt(position, Direction.UP, seed)) return false;
            BlockState replanted = ((CropBlock) harvestedCrop.getBlock()).getStateForAge(0);
            if (!replanted.canSurvive(level, position)
                    || !level.isUnobstructed(replanted, position, CollisionContext.placementContext(player))) return false;
            // This is an enchantment world effect, not a fabricated stream of player place
            // packets. Dispatching BlockItem.place 25 times falsely trips placement anti-cheat.
            // Use native state survival/collision checks and the explicit permission callback
            // above, then charge exactly one real seed only after the state update succeeds.
            if (!level.setBlock(position, replanted, 3)) return false;
            seed.shrink(1);
            inventory.setChanged();
            player.inventoryMenu.broadcastChanges();
            if (player.containerMenu != player.inventoryMenu) player.containerMenu.broadcastChanges();
            return true;
        }
        return false;
    }
}
