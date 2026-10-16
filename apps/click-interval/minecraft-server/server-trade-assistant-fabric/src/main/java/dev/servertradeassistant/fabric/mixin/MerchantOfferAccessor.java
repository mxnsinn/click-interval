package dev.servertradeassistant.fabric.mixin;

import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.trading.ItemCost;
import net.minecraft.world.item.trading.MerchantOffer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.gen.Accessor;

import java.util.Optional;

@Mixin(MerchantOffer.class)
public interface MerchantOfferAccessor {
    @Accessor("baseCostA") @Mutable
    void tradeAssistant$setBaseCostA(ItemCost value);

    @Accessor("costB") @Mutable
    void tradeAssistant$setCostB(Optional<ItemCost> value);

    @Accessor("result") @Mutable
    void tradeAssistant$setResult(ItemStack value);

    @Accessor("maxUses") @Mutable
    void tradeAssistant$setMaxUses(int value);

    @Accessor("priceMultiplier") @Mutable
    void tradeAssistant$setPriceMultiplier(float value);

    @Accessor("xp") @Mutable
    void tradeAssistant$setXp(int value);
}
