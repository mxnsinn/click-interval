package dev.servertradeassistant.fabric.mixin;

import dev.servertradeassistant.fabric.ServerTradeAssistantRuntime;
import net.minecraft.client.gui.components.ImageButton;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.components.WidgetSprites;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.MerchantScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.MerchantMenu;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MerchantScreen.class)
public abstract class MerchantScreenMixin extends AbstractContainerScreen<MerchantMenu> {
    @Unique private static final WidgetSprites TRADE_ASSISTANT_SPRITES = new WidgetSprites(
            Identifier.fromNamespaceAndPath("tradeassistant", "cycle"),
            Identifier.fromNamespaceAndPath("tradeassistant", "cycle_disabled"),
            Identifier.fromNamespaceAndPath("tradeassistant", "cycle_highlighted"));
    @Unique private ImageButton tradeAssistant$cycleButton;

    protected MerchantScreenMixin(MerchantMenu menu, Inventory inventory, Component title) {
        super(menu, inventory, title);
    }

    @Inject(method = "init", at = @At("TAIL"))
    private void tradeAssistant$addCycleButton(CallbackInfo callback) {
        Component label = Component.translatable("tradeassistant.button.cycle");
        tradeAssistant$cycleButton = new ImageButton(
                leftPos + imageWidth - 24,
                topPos + 4,
                20,
                20,
                TRADE_ASSISTANT_SPRITES,
                button -> {
                    if (minecraft != null && minecraft.gameMode != null) {
                        minecraft.gameMode.handleInventoryButtonClick(menu.containerId,
                                ServerTradeAssistantRuntime.CYCLE_BUTTON_ID);
                    }
                },
                label);
        tradeAssistant$cycleButton.setTooltip(Tooltip.create(
                Component.translatable("tradeassistant.button.cycle.tooltip")));
        addRenderableWidget(tradeAssistant$cycleButton);
        tradeAssistant$updateButton();
    }

    @Inject(method = "containerTick", at = @At("TAIL"))
    private void tradeAssistant$refreshCycleButton(CallbackInfo callback) {
        tradeAssistant$updateButton();
    }

    @Unique
    private void tradeAssistant$updateButton() {
        if (tradeAssistant$cycleButton == null) return;
        tradeAssistant$cycleButton.active = menu.getTraderLevel() == 1
                && menu.getTraderXp() == 0
                && !menu.getOffers().isEmpty()
                && menu.getOffers().stream().noneMatch(offer -> offer.getUses() > 0);
    }
}
