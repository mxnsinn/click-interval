package dev.servertradeassistant.fabric.mixin;

import dev.servertradeassistant.fabric.ServerTradeAssistantRuntime;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MerchantMenu;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(AbstractContainerMenu.class)
public abstract class AbstractContainerMenuMixin {
    @Inject(method = "clickMenuButton", at = @At("HEAD"), cancellable = true)
    private void tradeAssistant$handleCycleButton(Player player, int buttonId,
            CallbackInfoReturnable<Boolean> callback) {
        if (buttonId != ServerTradeAssistantRuntime.CYCLE_BUTTON_ID
                || !((Object) this instanceof MerchantMenu menu)) return;
        callback.setReturnValue(ServerTradeAssistantRuntime.active().tryCycleTrades(player, menu));
    }
}
