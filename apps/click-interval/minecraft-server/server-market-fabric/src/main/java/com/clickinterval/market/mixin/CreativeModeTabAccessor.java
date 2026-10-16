package com.clickinterval.market.mixin;

import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import java.util.function.Supplier;

/** Read generators only; never touch the creative screen's shared mutable caches. */
@Mixin(CreativeModeTab.class)
public interface CreativeModeTabAccessor {
    @Accessor("displayItemsGenerator") CreativeModeTab.DisplayItemsGenerator market$displayItemsGenerator();
    @Accessor("iconGenerator") Supplier<ItemStack> market$iconGenerator();
}
