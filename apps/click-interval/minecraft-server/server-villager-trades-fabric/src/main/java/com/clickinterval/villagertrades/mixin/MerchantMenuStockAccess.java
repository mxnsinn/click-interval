package com.clickinterval.villagertrades.mixin;

import net.minecraft.world.inventory.MerchantContainer;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.item.trading.Merchant;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Read-only native ownership/result access; no replacement menu or custom session state. */
@Mixin(MerchantMenu.class)
public interface MerchantMenuStockAccess {
    @Accessor("trader") Merchant clickInterval$stockTrader();
    @Accessor("tradeContainer") MerchantContainer clickInterval$stockContainer();
}
