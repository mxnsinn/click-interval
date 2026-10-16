package com.clickinterval.market;

import com.clickinterval.market.mixin.CreativeModeTabAccessor;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.flag.FeatureFlagSet;
import net.minecraft.world.item.*;
import java.util.*;

/** Per-server immutable snapshots. Registry work happens once, never on paging clicks. */
final class WantedItemCatalog {
    private static final Map<MinecraftServer,WantedItemCatalog> CACHE=new IdentityHashMap<>();
    static final class Category {
        private final Component name;
        private final ItemStack icon;
        private final List<ItemStack> items;
        Category(Component name,ItemStack icon,Collection<ItemStack> items) {
            this.name=name.copy(); this.icon=icon.copyWithCount(1);
            this.items=items.stream().map(v->v.copyWithCount(1)).toList();
        }
        Component name() { return name.copy(); }
        ItemStack icon() { return icon.copy(); }
        int size() { return items.size(); }
        ItemStack item(int index) { return items.get(index).copy(); }
    }
    private final List<Category> categories;
    private WantedItemCatalog(MinecraftServer server) {
        FeatureFlagSet flags=server.getWorldData().enabledFeatures();
        List<Category> result=new ArrayList<>();
        Set<ItemStack> all=ItemStackLinkedSet.createTypeAndComponentsSet();
        Set<Item> represented=Collections.newSetFromMap(new IdentityHashMap<>());
        // Run vanilla/common tab generators into our OWN output. Calling the
        // global buildContents/tryRebuildTabContents would race the integrated
        // client's creative-screen caches, even with a lock on our side only.
        var parameters=new CreativeModeTab.ItemDisplayParameters(flags,false,server.registryAccess());
        for(CreativeModeTab tab:CreativeModeTabs.allTabs()) {
            if(tab.getType()!=CreativeModeTab.Type.CATEGORY) continue;
            Set<ItemStack> items=ItemStackLinkedSet.createTypeAndComponentsSet();
            var generators=(CreativeModeTabAccessor)tab;
            ItemStack icon=new ItemStack(Items.CHEST);
            try {
                generators.market$displayItemsGenerator().accept(parameters,(sample,visibility)-> {
                    if(allowed(sample,flags)) items.add(sample.copyWithCount(1));
                });
                icon=generators.market$iconGenerator().get();
            } catch(RuntimeException failure) {
                // A third-party creative-only generator cannot hide registry items.
                ServerMarket.LOGGER.warn("Could not populate wanted-item category {}; registry fallback remains available",tab.getDisplayName().getString(),failure);
            }
            for(ItemStack sample:items) { all.add(sample); represented.add(sample.getItem()); }
            if(!items.isEmpty()) result.add(new Category(tab.getDisplayName(),icon,items));
        }
        // Creative tabs omit some legitimate registry items, including mod items.
        // Retain them in Other items and All items without adding empty potion/book
        // templates when meaningful component variants already exist in a tab.
        List<ItemStack> other=new ArrayList<>();
        for(Item item:BuiltInRegistries.ITEM) {
            ItemStack stack=item.getDefaultInstance();
            if(!represented.contains(item) && allowed(stack,flags)) { other.add(stack); all.add(stack); }
        }
        if(!other.isEmpty()) result.add(new Category(Component.literal("Other items"),new ItemStack(Items.CHEST),other));
        List<ItemStack> sorted=new ArrayList<>(all);
        // Stable server order; visible names remain translatable on each player's client.
        sorted.sort(Comparator.comparing(v->BuiltInRegistries.ITEM.getKey(v.getItem()).toString()));
        result.addFirst(new Category(Component.literal("All items"),new ItemStack(Items.COMPASS),sorted));
        categories=List.copyOf(result);
        ServerMarket.LOGGER.info("Wanted item catalog cached: {} categories, {} item/component variants",categories.size(),sorted.size());
    }
    static boolean allowed(ItemStack stack,FeatureFlagSet flags) {
        if(stack.isEmpty() || !stack.getItem().isEnabled(flags)) return false;
        var key=BuiltInRegistries.ITEM.getKey(stack.getItem());
        return PickerPolicy.allowed(key.getNamespace(),key.getPath());
    }
    static WantedItemCatalog get(MinecraftServer server) { return CACHE.computeIfAbsent(server,WantedItemCatalog::new); }
    static void invalidate(MinecraftServer server) { CACHE.remove(server); }
    List<Category> categories() { return categories; }
}
