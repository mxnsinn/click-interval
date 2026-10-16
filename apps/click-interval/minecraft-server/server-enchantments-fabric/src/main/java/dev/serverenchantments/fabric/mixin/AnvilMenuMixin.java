package dev.serverenchantments.fabric.mixin;

import dev.serverenchantments.fabric.core.AnvilCostPolicy;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.inventory.ContainerLevelAccess;
import net.minecraft.world.inventory.ItemCombinerMenu;
import net.minecraft.world.inventory.ItemCombinerMenuSlotDefinition;
import net.minecraft.world.inventory.MenuType;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

@Mixin(AnvilMenu.class)
public abstract class AnvilMenuMixin extends ItemCombinerMenu {
    protected AnvilMenuMixin(MenuType<?> type, int id, Inventory inventory,
                             ContainerLevelAccess access, ItemCombinerMenuSlotDefinition slots) {
        super(type, id, inventory, access, slots);
    }

    // Change the synchronized native price before vanilla's >=40 output gate.
    // All invalid-combination early returns still return empty, and mayPickup,
    // onTake, XP deduction, repair-material consumption and anvil damage stay native.
    @ModifyArg(method = "createResult", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/world/inventory/DataSlot;set(I)V"), index = 0)
    private int serverenchantments$capSurvivalPrice(int nativeCost) {
        // A client joining an unrelated server must not invent a cheaper prediction.
        // Dedicated and integrated servers synchronize their authoritative cost/result.
        if (!(player instanceof ServerPlayer)) return nativeCost;
        return AnvilCostPolicy.cappedCost(nativeCost, player.hasInfiniteMaterials(), inputSlots.getItem(0).getCount());
    }
}
