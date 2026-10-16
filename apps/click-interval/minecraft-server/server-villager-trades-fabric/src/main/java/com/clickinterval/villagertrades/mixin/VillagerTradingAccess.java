package com.clickinterval.villagertrades.mixin;

import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Villager.class)
public interface VillagerTradingAccess {
    @Invoker("updateSpecialPrices")
    void clickInterval$updateSpecialPrices(Player player);
}
