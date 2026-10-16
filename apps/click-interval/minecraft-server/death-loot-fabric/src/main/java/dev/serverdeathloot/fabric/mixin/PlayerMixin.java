package dev.serverdeathloot.fabric.mixin;

import dev.serverdeathloot.fabric.ServerDeathLootFabric;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Redirects only vanilla's player-death inventory drop call. Ordinary item drops never enter here. */
@Mixin(Player.class)
abstract class PlayerMixin {
    @Redirect(
            method = "dropEquipment",
            at = @At(
                    value = "INVOKE",
                    target = "Lnet/minecraft/world/entity/player/Inventory;dropAll()V"
            )
    )
    private void serverDeathLoot$handleDeathInventory(Inventory inventory, ServerLevel level) {
        Player player = (Player) (Object) this;
        if (!(player instanceof ServerPlayer serverPlayer)
                || !ServerDeathLootFabric.handleDeathInventory(serverPlayer, inventory)) {
            inventory.dropAll();
        }
    }
}
