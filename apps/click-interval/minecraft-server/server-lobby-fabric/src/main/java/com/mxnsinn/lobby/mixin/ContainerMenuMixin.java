package com.mxnsinn.lobby.mixin;

import com.mxnsinn.lobby.LobbyPreviewGuard;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerInput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Cancel before vanilla extracts stacks, so disallowed drops cannot delete inventory items. */
@Mixin(AbstractContainerMenu.class)
public abstract class ContainerMenuMixin {
    @Inject(method = "clicked", at = @At("HEAD"), cancellable = true)
    private void lobby$noInventoryDrop(int slot, int button, ContainerInput input, Player player, CallbackInfo ci) {
        if (player instanceof ServerPlayer serverPlayer && LobbyPreviewGuard.active(player.level())
                && (input == ContainerInput.THROW || slot == AbstractContainerMenu.SLOT_CLICKED_OUTSIDE)) {
            serverPlayer.containerMenu.sendAllDataToRemote();
            ci.cancel();
        }
    }
}
