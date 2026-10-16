package com.clickinterval.villagertrades.mixin;
import com.clickinterval.villagertrades.CycleMenuSession;
import com.clickinterval.villagertrades.MerchantMenuCycleAccess;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.item.trading.Merchant;
import org.spongepowered.asm.mixin.*;
@Mixin(MerchantMenu.class)
public abstract class MerchantMenuCycleMixin implements MerchantMenuCycleAccess {
    @Shadow @Final private Merchant trader;
    @Unique private final CycleMenuSession clickInterval$session = new CycleMenuSession();
    @Override public Merchant clickInterval$merchant() { return trader; }
    @Override public CycleMenuSession clickInterval$cycleSession() { return clickInterval$session; }
}
