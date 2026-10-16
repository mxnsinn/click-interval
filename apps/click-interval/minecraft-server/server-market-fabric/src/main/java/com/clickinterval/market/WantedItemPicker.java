package com.clickinterval.market;

import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.*;
import net.minecraft.world.item.*;
import net.minecraft.world.item.component.ItemLore;
import java.util.*;
import java.util.function.Consumer;

/** Shared market/auction browser. Every visible stack is an untransferable copy. */
final class WantedItemPicker {
    private static final Item GRAY=Items.STAINED_GLASS_PANE.pick(DyeColor.GRAY);
    private WantedItemPicker() {}
    static void open(ServerPlayer owner,MarketService.Draft draft,Consumer<ItemStack> selected,Runnable back) {
        List<WantedItemCatalog.Category> categories=new ArrayList<>();
        // Preserve exact custom names, enchantments, damage and container contents.
        Set<ItemStack> owned=ItemStackLinkedSet.createTypeAndComponentsSet();
        for(ItemStack stack:MarketService.inventory(owner)) if(!stack.isEmpty()) owned.add(stack.copyWithCount(1));
        categories.add(new WantedItemCatalog.Category(Component.literal("Your inventory"),new ItemStack(Items.CHEST),owned));
        categories.addAll(WantedItemCatalog.get(owner.level().getServer()).categories());
        open(owner,draft,List.copyOf(categories),selected,back,-1,0);
    }
    private static void open(ServerPlayer owner,MarketService.Draft draft,List<WantedItemCatalog.Category> categories,
                             Consumer<ItemStack> selected,Runnable back,int category,int page) {
        if(!owner.isAlive() || owner.isRemoved() || owner.isSpectator()) return;
        Component title=category<0?Component.literal("Wanted item: choose a category")
                :Component.literal("Wanted: ").append(categories.get(category).name());
        owner.openMenu(new SimpleMenuProvider((id,inventory,player)->new Menu(id,owner,draft,categories,selected,back,category,page),title));
    }
    static final class Menu extends ChestMenu {
        private final ServerPlayer owner;
        private final MarketService.Draft draft;
        private final List<WantedItemCatalog.Category> categories;
        private final Consumer<ItemStack> selected;
        private final Runnable back;
        private final SimpleContainer display;
        private final int category,page,size;
        private boolean consumed;
        Menu(int id,ServerPlayer owner,MarketService.Draft draft,List<WantedItemCatalog.Category> categories,
             Consumer<ItemStack> selected,Runnable back,int category,int page) {
            this(id,owner,draft,categories,selected,back,category,page,new SimpleContainer(54));
        }
        private Menu(int id,ServerPlayer owner,MarketService.Draft draft,List<WantedItemCatalog.Category> categories,
                     Consumer<ItemStack> selected,Runnable back,int category,int page,SimpleContainer display) {
            super(MenuType.GENERIC_9x6,id,owner.getInventory(),display,6);
            this.owner=owner; this.draft=draft; this.categories=List.copyOf(categories);
            this.selected=selected; this.back=back; this.category=category; this.display=display;
            size=category<0?categories.size():categories.get(category).size(); this.page=PickerPolicy.clampPage(page,size);
            for(int index=0;index<slots.size();index++) {
                Slot old=slots.get(index);
                Slot locked=new Slot(old.container,old.getContainerSlot(),old.x,old.y) {
                    @Override public boolean mayPlace(ItemStack stack) { return false; }
                    @Override public boolean mayPickup(Player player) { return false; }
                };
                locked.index=index; slots.set(index,locked);
            }
            render();
        }
        @Override public boolean stillValid(Player player) { return player==owner && owner.isAlive() && !owner.isRemoved() && !owner.isSpectator(); }
        @Override public ItemStack quickMoveStack(Player player,int slot) { return ItemStack.EMPTY; }
        @Override public boolean canDragTo(Slot slot) { return false; }
        @Override public boolean canTakeItemForPickAll(ItemStack stack,Slot slot) { return false; }
        @Override public boolean clickMenuButton(Player player,int button) { return false; }
        @Override public void setSelectedBundleItemIndex(int slot,int index) {}
        @Override public void removed(Player player) { consumed=true; super.removed(player); }
        @Override public void clicked(int slot,int button,ContainerInput input,Player player) {
            if(player!=owner || owner.containerMenu!=this || !stillValid(player) || consumed) return;
            try {
                if(!MenuPolicy.accepts(slot,button,input==ContainerInput.PICKUP)) return;
                if(slot==45) {
                    consumed=true;
                    if(category<0) back.run(); else navigate(-1,0);
                } else if(slot==47 && page>0) { consumed=true; navigate(category,page-1); }
                else if(slot==51 && page+1<PickerPolicy.pages(size)) { consumed=true; navigate(category,page+1); }
                else {
                    int index=PickerPolicy.index(page,slot,size); if(index<0) return;
                    if(category<0) { consumed=true; navigate(index,0); }
                    else {
                        ItemStack sample=categories.get(category).item(index);
                        if(!ItemStack.matches(draft.expected(),owner.getInventory().getItem(draft.slot()))) {
                            consumed=true;
                            owner.sendSystemMessage(Component.literal("Your offered stack changed. Choose it again; no items were taken.").withStyle(ChatFormatting.RED));
                            back.run(); return;
                        }
                        if(category==0 && MarketService.inventory(owner).stream().noneMatch(v->ItemStack.isSameItemSameComponents(v,sample))) {
                            owner.sendSystemMessage(Component.literal("That exact inventory sample changed. Go back and choose your offered item again.").withStyle(ChatFormatting.RED));
                            return;
                        }
                        consumed=true; selected.accept(sample.copyWithCount(1));
                    }
                }
            } finally {
                if(owner.containerMenu==this) sendAllDataToRemote();
                owner.inventoryMenu.broadcastChanges();
            }
        }
        private void navigate(int category,int page) {
            // Fresh native container ID on EVERY navigation: queued old-page clicks
            // cannot select a different entry or replay selection in a later page.
            open(owner,draft,categories,selected,back,category,page);
        }
        private void render() {
            for(int slot=0;slot<9;slot++) display.setItem(slot,icon(GRAY,Component.literal(" ")));
            for(int slot=45;slot<54;slot++) display.setItem(slot,icon(GRAY,Component.literal(" ")));
            display.setItem(2,annotate(draft.expected().copyWithCount(draft.offered()),Component.literal("You are offering this item"),Component.literal("Nothing moves until final confirmation.")));
            display.setItem(4,icon(Items.PAPER,Component.literal("Choose what you want for this item"),
                    Component.literal("Offered item: ").append(draft.expected().getHoverName()),
                    Component.literal(category<0?"Choose a category below.":"Click an item below, then set the amount."),
                    Component.literal("You do not need to own the wanted item.")));
            for(int slot=9;slot<45;slot++) {
                int index=PickerPolicy.index(page,slot,size); if(index<0) break;
                if(category<0) {
                    var entry=categories.get(index); ItemStack icon=entry.icon();
                    icon.set(DataComponents.CUSTOM_NAME,entry.name().copy().withStyle(style->style.withItalic(false).withColor(ChatFormatting.WHITE)));
                    display.setItem(slot,annotate(icon,Component.literal(entry.size()+" items / variants"),
                            Component.literal(index==0?"Exact samples, including custom components.":"Browse items without owning a sample.")));
                } else display.setItem(slot,annotate(categories.get(category).item(index),
                        Component.literal("Click to choose this wanted item"),Component.literal("Payment matches this item's exact components.")));
            }
            if(size==0) display.setItem(22,icon(Items.PAPER,Component.literal("No items in this category")));
            display.setItem(45,icon(Items.ARROW,Component.literal(category<0?"Back: choose offered item":"Back to categories")));
            if(page>0) display.setItem(47,icon(Items.ARROW,Component.literal("Previous page")));
            if(page+1<PickerPolicy.pages(size)) display.setItem(51,icon(Items.ARROW,Component.literal("Next page")));
            display.setItem(49,icon(Items.PAPER,Component.literal("Page "+(page+1)+" / "+PickerPolicy.pages(size)),
                    category<0?Component.literal("Categories"):categories.get(category).name()));
        }
    }
    private static ItemStack icon(Item item,Component title,Component... lines) {
        ItemStack stack=new ItemStack(item); stack.set(DataComponents.CUSTOM_NAME,title.copy().withStyle(style->style.withItalic(false).withColor(ChatFormatting.WHITE)));
        return annotate(stack,lines);
    }
    private static ItemStack annotate(ItemStack stack,Component... lines) {
        ItemStack copy=stack.copy(); List<Component> lore=new ArrayList<>(copy.getOrDefault(DataComponents.LORE,ItemLore.EMPTY).lines());
        if(lore.size()>12) lore=new ArrayList<>(lore.subList(0,12));
        for(Component line:lines) lore.add(line.copy().withStyle(ChatFormatting.GRAY));
        copy.set(DataComponents.LORE,new ItemLore(lore)); return copy;
    }
}
