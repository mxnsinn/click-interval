package com.clickinterval.villagertrades.client;

import com.clickinterval.villagertrades.network.CycleRequest;
import com.clickinterval.villagertrades.network.CycleStatus;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.MerchantScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Util;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.item.trading.MerchantOffers;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Adds one widget; never replaces the merchant screen or intercepts closing it. */
@Mixin(MerchantScreen.class)
public abstract class MerchantScreenMixin extends AbstractContainerScreen<MerchantMenu> implements CycleScreen {
    @Shadow private int shopItem;
    @Shadow private int scrollOff;
    @Unique private Button clickInterval$cycleButton;
    @Unique private CycleButtonState clickInterval$state;
    @Unique private MerchantOffers clickInterval$requestedOffers;

    protected MerchantScreenMixin(MerchantMenu menu, Inventory inventory, Component title) { super(menu, inventory, title); }

    @Inject(method = "init", at = @At("TAIL"))
    private void clickInterval$addCycleButton(CallbackInfo callback) {
        if (clickInterval$state == null) clickInterval$state = new CycleButtonState(menu.containerId);
        clickInterval$cycleButton = addRenderableWidget(new CycleIconButton(leftPos + imageWidth - 22, topPos + 4, button -> {
            if (!clickInterval$state.begin(clickInterval$available(), clickInterval$emptyInputs(), Util.getMillis())) return;
            clickInterval$requestedOffers = menu.getOffers();
            button.active = false;
            ClientPlayNetworking.send(new CycleRequest(menu.containerId, clickInterval$state.nonce(), true));
        }));
        clickInterval$cycleButton.setTooltip(Tooltip.create(Component.literal("Cycle trades — clear the payment slots first")));
        // Start hidden: no one-frame button flash before the server confirms this exact merchant.
        clickInterval$cycleButton.visible = false;
        clickInterval$cycleButton.active = false;
        // Native resize/re-init recreates widgets, not this screen's confirmed protocol state.
        clickInterval$refreshButton();
    }

    @Inject(method = "extractContents", at = @At("HEAD"))
    private void clickInterval$updateButton(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo callback) {
        clickInterval$refreshButton();
    }

    @Unique private void clickInterval$refreshButton() {
        if (clickInterval$cycleButton == null) return;
        long now = Util.getMillis();
        boolean supported = ClientPlayNetworking.canSend(CycleRequest.TYPE);
        boolean used = clickInterval$anyUsedOffer();
        if (clickInterval$state.queryIfDue(supported,
                CycleButtonState.nativeCandidate(menu.getTraderXp(), menu.getTraderLevel(), !menu.getOffers().isEmpty(), used), now))
            ClientPlayNetworking.send(new CycleRequest(menu.containerId, 0, false));
        boolean available = clickInterval$state.visible(supported, menu.getTraderXp(),
                menu.getTraderLevel(), !menu.getOffers().isEmpty(), used);
        clickInterval$cycleButton.visible = available;
        clickInterval$cycleButton.active = clickInterval$state.enabled(available, clickInterval$emptyInputs(), now);
    }

    @Override public void clickInterval$acceptCycleStatus(CycleStatus status) {
        if (clickInterval$state == null) return;
        boolean pending = clickInterval$state.pending();
        if (!clickInterval$state.accept(status.containerId(), status.nonce(), status.eligible())) return;
        // Successful cycles send native offers before the status. A rejected cycle must not
        // change normal merchant selection or recompute payment slots.
        if (pending && clickInterval$requestedOffers != menu.getOffers()) {
            shopItem = 0; scrollOff = 0; menu.setSelectionHint(0);
        }
        clickInterval$requestedOffers = null;
        clickInterval$refreshButton();
    }

    @Unique private boolean clickInterval$available() {
        return clickInterval$state.visible(ClientPlayNetworking.canSend(CycleRequest.TYPE), menu.getTraderXp(),
                menu.getTraderLevel(), !menu.getOffers().isEmpty(), clickInterval$anyUsedOffer());
    }
    @Unique private boolean clickInterval$anyUsedOffer() {
        for (var offer : menu.getOffers()) if (offer.getUses() != 0) return true;
        return false;
    }
    @Unique private boolean clickInterval$emptyInputs() {
        return menu.getSlot(0).getItem().isEmpty() && menu.getSlot(1).getItem().isEmpty()
                && menu.getSlot(2).getItem().isEmpty() && menu.getCarried().isEmpty();
    }
}
