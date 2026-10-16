package dev.serverenchantments.fabric;

import dev.serverenchantments.fabric.core.SmeltAmounts;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.ItemTags;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.RecipeManager;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.item.crafting.SingleRecipeInput;
import net.minecraft.world.item.crafting.SmeltingRecipe;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayList;
import java.util.List;

/** Converts native, already-Fortune-resolved loot once, immediately before native item spawning. */
public final class Smelter {
    public static final ResourceKey<Enchantment> KEY = ResourceKey.create(Registries.ENCHANTMENT,
            Identifier.fromNamespaceAndPath("serverenchantments", "smelter"));
    // Vanilla's cached check keeps only a recipe ID, and revalidates it through the current
    // level's manager on every call. It cannot retain a stale output across /reload/worlds.
    private static final RecipeManager.CachedCheck<SingleRecipeInput, SmeltingRecipe> RECIPES =
            RecipeManager.createCheck(RecipeType.SMELTING);
    private Smelter() { }

    public static List<ItemStack> transformDrops(List<ItemStack> nativeDrops, BlockState state,
                                                 ServerLevel level, Entity actor, ItemStack tool) {
        if (nativeDrops.isEmpty() || nativeDrops.size() > SmeltAmounts.MAX_INPUT_STACKS
                || state.hasBlockEntity() || !(actor instanceof ServerPlayer player)
                || player.level() != level || player.isCreative() || player.isSpectator()
                || tool.isEmpty() || !tool.is(ItemTags.PICKAXES)) return nativeDrops;
        var enchantments = level.registryAccess().lookupOrThrow(Registries.ENCHANTMENT);
        var smelter = enchantments.get(KEY);
        if (smelter.isEmpty() || EnchantmentHelper.getItemEnchantmentLevel(smelter.get(), tool) <= 0
                // Commands can force incompatible enchants together. Prefer Silk Touch,
                // never silently smelt a block the player explicitly collected intact.
                || EnchantmentHelper.getItemEnchantmentLevel(enchantments.getOrThrow(Enchantments.SILK_TOUCH), tool) > 0)
            return nativeDrops;

        ArrayList<ItemStack> result = new ArrayList<>(nativeDrops.size());
        boolean changed = false;
        for (int index = 0; index < nativeDrops.size(); index++) {
            ItemStack drop = nativeDrops.get(index);
            if (drop.isEmpty()) { result.add(drop); continue; }
            SingleRecipeInput input = new SingleRecipeInput(drop.copyWithCount(1));
            var recipe = RECIPES.getRecipeFor(input, level);
            if (recipe.isEmpty()) { result.add(drop); continue; }
            ItemStack cooked = recipe.get().value().assemble(input);
            if (cooked.isEmpty()) { result.add(drop); continue; }
            // Reserve one slot for every unprocessed native entry. A pathological data
            // pack falls back to its original drop, never truncates items or allocates huge lists.
            int available = SmeltAmounts.MAX_OUTPUT_STACKS - result.size() - (nativeDrops.size() - index - 1);
            int amount = SmeltAmounts.total(drop.getCount(), cooked.getCount(), cooked.getMaxStackSize(), available);
            if (amount == 0) { result.add(drop); continue; }
            while (amount > 0) {
                int count = Math.min(amount, cooked.getMaxStackSize());
                result.add(cooked.copyWithCount(count));
                amount -= count;
            }
            changed = true;
        }
        // Do not mutate native input stacks. No second loot roll, entity sweep, inventory
        // insertion, recursive cooking, XP reward or server-tick/world scanning happens here.
        return changed ? result : nativeDrops;
    }
}
