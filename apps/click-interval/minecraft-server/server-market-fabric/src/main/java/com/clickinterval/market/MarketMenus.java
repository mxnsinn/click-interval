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

/** Display-only vanilla chest inventory. Real items never enter these slots. */
public final class MarketMenus {
    enum Page { BOARD, MINE, OFFER, WANT, CREATE, BUY, CANCEL }
    private static final Item GRAY=Items.STAINED_GLASS_PANE.pick(DyeColor.GRAY);
    private static final Item GREEN=Items.STAINED_GLASS_PANE.pick(DyeColor.LIME);
    private MarketMenus() {}
    public static void board(ServerPlayer player,MarketService service) { open(player,service,Page.BOARD,null,null); }
    public static void mine(ServerPlayer player,MarketService service) { open(player,service,Page.MINE,null,null); }
    public static void create(ServerPlayer player,MarketService service) { open(player,service,Page.OFFER,null,null); }
    private static void open(ServerPlayer player,MarketService service,Page page,MarketService.Draft draft,MarketService.Listing listing) {
        if(!player.isAlive() || player.isRemoved() || player.isSpectator()) return;
        if(page==Page.WANT) {
            WantedItemPicker.open(player,draft,
                    sample->open(player,service,Page.CREATE,new MarketService.Draft(draft.slot(),draft.expected(),draft.offered(),sample,1),null),
                    ()->create(player,service));
            return;
        }
        String title=switch(page) {
            case BOARD -> "Market: item-for-item"; case MINE -> "My market listings";
            case OFFER -> "Create: choose offered item"; case WANT -> "Create: choose wanted item";
            case CREATE -> "Confirm listing & amounts"; case BUY -> "Confirm exact-item purchase"; case CANCEL -> "Confirm listing cancellation";
        };
        player.openMenu(new SimpleMenuProvider((id,inventory,actor)->new Menu(id,player,service,page,draft,listing),Component.literal(title)));
    }
    static final class Menu extends ChestMenu {
        private final ServerPlayer owner;
        private final MarketService service;
        private final Page page;
        private final SimpleContainer display;
        private final List<ItemStack> inventorySnapshot;
        private final MarketService.Listing selected;
        private MarketService.Draft draft;
        private List<MarketService.Listing> entries=List.of();
        private int number,pages=1;
        private boolean submitted;
        private long inputWindow=System.nanoTime();
        private int inputs;
        Menu(int id,ServerPlayer owner,MarketService service,Page page,MarketService.Draft draft,MarketService.Listing selected) {
            this(id,owner,service,page,draft,selected,new SimpleContainer(54));
        }
        private Menu(int id,ServerPlayer owner,MarketService service,Page page,MarketService.Draft draft,MarketService.Listing selected,SimpleContainer display) {
            super(MenuType.GENERIC_9x6,id,owner.getInventory(),display,6);
            this.owner=owner; this.service=service; this.page=page; this.draft=draft; this.selected=selected; this.display=display;
            inventorySnapshot=MarketService.inventory(owner);
            for(int i=0;i<slots.size();i++) {
                Slot old=slots.get(i); Slot locked=new Slot(old.container,old.getContainerSlot(),old.x,old.y) {
                    @Override public boolean mayPlace(ItemStack stack) { return false; }
                    @Override public boolean mayPickup(Player player) { return false; }
                }; locked.index=i; slots.set(i,locked);
            }
            refresh();
        }
        @Override public boolean stillValid(Player player) { return player==owner && owner.isAlive() && !owner.isRemoved() && !owner.isSpectator(); }
        @Override public ItemStack quickMoveStack(Player player,int slot) { return ItemStack.EMPTY; }
        @Override public boolean canDragTo(Slot slot) { return false; }
        @Override public boolean canTakeItemForPickAll(ItemStack stack,Slot slot) { return false; }
        @Override public boolean clickMenuButton(Player player,int button) { return false; }
        @Override public void setSelectedBundleItemIndex(int slot,int index) {}
        @Override public void clicked(int slot,int button,ContainerInput input,Player player) {
            if(player!=owner || owner.containerMenu!=this || !stillValid(player) || submitted) return;
            try {
                long now=System.nanoTime(); if(now-inputWindow>=1_000_000_000L) { inputs=0; inputWindow=now; }
                if(++inputs>20 || !MenuPolicy.accepts(slot,button,input==ContainerInput.PICKUP)) return;
                if(slot==45) {
                    if(page==Page.CREATE && draft!=null) open(owner,service,Page.WANT,draft,null);
                    else board(owner,service);
                    return;
                }
                if(page==Page.BOARD || page==Page.MINE) {
                    int index=number*45+slot;
                    if(slot<45 && index<entries.size()) {
                        MarketService.Listing listing=entries.get(index);
                        open(owner,service,listing.seller().equals(owner.getUUID())?Page.CANCEL:Page.BUY,null,listing);
                    } else if(slot==46) create(owner,service);
                    else if(slot==48) mine(owner,service);
                    else if(slot==47 && number>0) { number--; render(); }
                    else if(slot==51 && number+1<pages) { number++; render(); }
                    else if(slot==49) refresh();
                    else if(slot==52) { tell(service.claim(owner)); refresh(); }
                    return;
                }
                if(page==Page.OFFER) {
                    if(slot>=36) return; int inventorySlot=slot<27?slot+9:slot-27;
                    ItemStack sample=inventorySnapshot.get(inventorySlot);
                    if(sample.isEmpty() || !ItemStack.matches(sample,owner.getInventory().getItem(inventorySlot))) {
                        tell(new MarketService.Result(false,"That inventory stack changed. Reopen Create listing.")); return;
                    }
                    open(owner,service,Page.WANT,new MarketService.Draft(inventorySlot,sample,1,sample,1),null);
                    return;
                }
                if(page==Page.CREATE && draft!=null) {
                    int offered=draft.offered(),wanted=draft.count();
                    if(slot==19) offered--; else if(slot==21) offered++; else if(slot==28) offered-=8; else if(slot==30) offered+=8;
                    else if(slot==23) wanted--; else if(slot==25) wanted++; else if(slot==32) wanted-=8; else if(slot==34) wanted+=8;
                    else if(slot==53) { submitted=true; submit(service.post(owner,draft)); return; }
                    draft=new MarketService.Draft(draft.slot(),draft.expected(),Math.clamp(offered,1,draft.expected().getCount()),draft.want(),Math.clamp(wanted,1,Math.min(4096,36*draft.want().getMaxStackSize())));
                    render(); return;
                }
                if(slot==53 && selected!=null) {
                    // UUIDs are immutable listing identities; a sold/cancelled ID cannot return.
                    submitted=true; MarketService.Result result=page==Page.BUY?service.buy(owner,selected.id()):service.cancel(owner,selected.id());
                    tell(result); board(owner,service);
                }
            } finally {
                if(owner.containerMenu==this) sendAllDataToRemote();
                owner.inventoryMenu.broadcastChanges();
            }
        }
        private void submit(MarketService.Result result) { submitted=true; tell(result); board(owner,service); }
        private void tell(MarketService.Result result) { owner.sendSystemMessage(Component.literal(result.message()).withStyle(result.success()?ChatFormatting.GREEN:ChatFormatting.RED)); }
        private void refresh() {
            if(page==Page.BOARD || page==Page.MINE) entries=service.listings().stream().filter(v->page!=Page.MINE || v.seller().equals(owner.getUUID())).toList();
            pages=Math.max(1,(entries.size()+44)/45); number=Math.min(number,pages-1); render();
        }
        private void render() {
            display.clearContent(); for(int i=45;i<54;i++) display.setItem(i,icon(GRAY," "));
            display.setItem(45,icon(Items.ARROW,page==Page.CREATE?"Back: choose wanted item":"Back to market / leave unchanged"));
            switch(page) {
                case BOARD,MINE -> {
                    for(int slot=0,index=number*45;slot<45 && index<entries.size();slot++,index++) {
                        MarketService.Listing entry=entries.get(index);
                        display.setItem(slot,annotate(entry.offer(),"Seller: "+entry.name(),"Wants: "+entry.count()+" x "+entry.want().getHoverName().getString(),"Exact item components required",entry.seller().equals(owner.getUUID())?"Click to review cancellation":"Click to review purchase","ID: "+entry.id()));
                    }
                    if(entries.isEmpty()) display.setItem(22,icon(Items.PAPER,"No listings yet"));
                    display.setItem(46,icon(GREEN,"Create listing","Choose offered item, then browse wanted items by category.","You do not need to own the wanted item."));
                    display.setItem(48,icon(Items.BOOK,"My listings","Only you can cancel your listings."));
                    display.setItem(49,icon(Items.PAPER,"Page "+(number+1)+" / "+pages,"Click to refresh"));
                    display.setItem(52,icon(Items.CHEST,"Collect proceeds & refunds","Saved stacks: "+service.pending(owner.getUUID()).size(),"Overflow remains safely stored."));
                    if(number>0) display.setItem(47,icon(Items.ARROW,"Previous"));
                    if(number+1<pages) display.setItem(51,icon(Items.ARROW,"Next"));
                }
                case OFFER -> {
                    for(int slot=0;slot<36;slot++) {
                        int inventorySlot=slot<27?slot+9:slot-27; ItemStack item=inventorySnapshot.get(inventorySlot);
                        if(!item.isEmpty()) display.setItem(slot,annotate(item,"Click to offer this exact stack","No items move until final confirmation."));
                    }
                    display.setItem(49,icon(Items.PAPER,"Choose offered item above","Next: browse wanted items by category.","No items move until final confirmation."));
                }
                case WANT -> throw new IllegalStateException("Wanted items use the shared picker");
                case CREATE -> {
                    display.setItem(20,draft.expected().copyWithCount(draft.offered())); display.setItem(24,draft.want());
                    display.setItem(19,icon(Items.ARROW,"Offer -1")); display.setItem(21,icon(Items.ARROW,"Offer +1"));
                    display.setItem(28,icon(Items.ARROW,"Offer -8")); display.setItem(30,icon(Items.ARROW,"Offer +8"));
                    display.setItem(23,icon(Items.ARROW,"Want -1")); display.setItem(25,icon(Items.ARROW,"Want +1"));
                    display.setItem(32,icon(Items.ARROW,"Want -8")); display.setItem(34,icon(Items.ARROW,"Want +8"));
                    display.setItem(49,icon(Items.PAPER,"Offer "+draft.offered()+" for "+draft.count(),"Hover actual items above to inspect components.","Wanted: "+draft.count()+" x "+draft.want().getHoverName().getString()));
                    display.setItem(53,icon(GREEN,"Confirm listing & escrow","Offer "+draft.offered()+" for "+draft.count()+" exact items.","This takes only the offered amount.","Escape cancels; Back changes the wanted item."));
                }
                case BUY,CANCEL -> {
                    if(selected==null) break;
                    display.setItem(20,selected.offer()); display.setItem(24,selected.want());
                    display.setItem(49,icon(Items.PAPER,"Offer "+selected.offer().getCount()+" for "+selected.count(),"Seller: "+selected.name(),"Hover both actual items above.","Payment matches ALL item components."));
                    display.setItem(53,icon(GREEN,page==Page.BUY?"Confirm purchase":"Confirm cancellation",page==Page.BUY?"Pay "+selected.count()+" exact items; receive offered stack.":"Return offered stack to your saved claims.","No drops. Full inventory cannot lose items."));
                }
            }
            broadcastChanges();
        }
    }
    private static ItemStack icon(Item item,String title,String... lines) {
        ItemStack stack=new ItemStack(item); stack.set(DataComponents.CUSTOM_NAME,Component.literal(title).withStyle(style->style.withItalic(false).withColor(ChatFormatting.WHITE)));
        return annotate(stack,lines);
    }
    private static ItemStack annotate(ItemStack item,String... lines) {
        ItemStack copy=item.copy(); List<Component> lore=new ArrayList<>(copy.getOrDefault(DataComponents.LORE,ItemLore.EMPTY).lines());
        if(lore.size()>12) lore=new ArrayList<>(lore.subList(0,12));
        for(String line:lines) lore.add(Component.literal(line).withStyle(ChatFormatting.GRAY)); copy.set(DataComponents.LORE,new ItemLore(lore)); return copy;
    }
}
