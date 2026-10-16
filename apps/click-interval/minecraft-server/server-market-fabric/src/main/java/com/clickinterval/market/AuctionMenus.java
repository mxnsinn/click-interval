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

/** Vanilla chest GUI; display copies cannot enter inventory through any click. */
public final class AuctionMenus {
    enum Page { BOARD,MINE,OFFER,WANT,CREATE,BID,CANCEL }
    private static final Item GRAY=Items.STAINED_GLASS_PANE.pick(DyeColor.GRAY),GREEN=Items.STAINED_GLASS_PANE.pick(DyeColor.LIME);
    private AuctionMenus() {}
    public static void board(ServerPlayer player,MarketService service) { open(player,service,Page.BOARD,null,null); }
    public static void mine(ServerPlayer player,MarketService service) { open(player,service,Page.MINE,null,null); }
    public static void create(ServerPlayer player,MarketService service) { open(player,service,Page.OFFER,null,null); }
    private static void open(ServerPlayer player,MarketService service,Page page,AuctionService.Draft draft,AuctionService.Auction auction) {
        if(!player.isAlive() || player.isRemoved() || player.isSpectator()) return;
        if(page==Page.WANT) {
            MarketService.Draft old=draft.items();
            WantedItemPicker.open(player,old,
                    sample->open(player,service,Page.CREATE,new AuctionService.Draft(new MarketService.Draft(old.slot(),old.expected(),old.offered(),sample,1),draft.duration()),null),
                    ()->create(player,service));
            return;
        }
        String title=switch(page) {
            case BOARD->"Auction house: timed bidding"; case MINE->"My auctions";
            case OFFER->"Auction: choose offered item"; case WANT->"Auction: choose payment item";
            case CREATE->"Confirm auction & duration"; case BID->"Review and confirm exact bid"; case CANCEL->"Cancel unbid auction";
        };
        player.openMenu(new SimpleMenuProvider((id,inventory,actor)->new Menu(id,player,service,page,draft,auction),Component.literal(title)));
    }
    static final class Menu extends ChestMenu {
        private final ServerPlayer owner;
        private final MarketService market;
        private final AuctionService service;
        private final Page page;
        private final SimpleContainer display;
        private final List<ItemStack> inventorySnapshot;
        private final AuctionService.Auction selected;
        private AuctionService.Draft draft;
        private List<AuctionService.Auction> entries=List.of();
        private int number,pages=1,bid;
        private boolean submitted;
        private long inputWindow=System.nanoTime();
        private int inputs;
        Menu(int id,ServerPlayer owner,MarketService market,Page page,AuctionService.Draft draft,AuctionService.Auction auction) {
            this(id,owner,market,page,draft,auction,new SimpleContainer(54));
        }
        private Menu(int id,ServerPlayer owner,MarketService market,Page page,AuctionService.Draft draft,AuctionService.Auction auction,SimpleContainer display) {
            super(MenuType.GENERIC_9x6,id,owner.getInventory(),display,6);
            this.owner=owner; this.market=market; service=market.auctions(); this.page=page; this.draft=draft; selected=auction; this.display=display;
            bid=auction==null?0:auction.nextBid(); inventorySnapshot=MarketService.inventory(owner);
            for(int i=0;i<slots.size();i++) {
                Slot previous=slots.get(i); Slot locked=new Slot(previous.container,previous.getContainerSlot(),previous.x,previous.y) {
                    @Override public boolean mayPlace(ItemStack item) { return false; }
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
                    if(page==Page.CREATE && draft!=null) open(owner,market,Page.WANT,draft,null);
                    else board(owner,market);
                    return;
                }
                if(page==Page.BOARD || page==Page.MINE) {
                    int index=number*45+slot;
                    if(slot<45 && index<entries.size()) {
                        AuctionService.Auction auction=entries.get(index); open(owner,market,auction.seller().equals(owner.getUUID())?Page.CANCEL:Page.BID,null,auction);
                    } else if(slot==46) create(owner,market);
                    else if(slot==48) mine(owner,market);
                    else if(slot==47 && number>0) { number--; render(); }
                    else if(slot==51 && number+1<pages) { number++; render(); }
                    else if(slot==49) refresh();
                    else if(slot==52) { tell(market.claim(owner)); refresh(); }
                    return;
                }
                if(page==Page.OFFER) {
                    if(slot>=36) return; int inventorySlot=slot<27?slot+9:slot-27; ItemStack sample=inventorySnapshot.get(inventorySlot);
                    if(sample.isEmpty() || !ItemStack.matches(sample,owner.getInventory().getItem(inventorySlot))) { tell(new MarketService.Result(false,"That sample changed. Reopen auction creation.")); return; }
                    open(owner,market,Page.WANT,new AuctionService.Draft(new MarketService.Draft(inventorySlot,sample,1,sample,1),3_600_000L),null);
                    return;
                }
                if(page==Page.CREATE && draft!=null) {
                    MarketService.Draft item=draft.items(); int offered=item.offered(),minimum=item.count(); long duration=draft.duration();
                    if(slot==19) offered--; else if(slot==21) offered++; else if(slot==28) offered-=8; else if(slot==30) offered+=8;
                    else if(slot==23) minimum--; else if(slot==25) minimum++; else if(slot==32) minimum-=8; else if(slot==34) minimum+=8;
                    else if(slot==37) duration-=60_000L; else if(slot==39) duration+=60_000L;
                    else if(slot==41) duration-=3_600_000L; else if(slot==43) duration+=3_600_000L;
                    else if(slot==53) { submitted=true; tell(service.create(owner,draft)); board(owner,market); return; }
                    draft=new AuctionService.Draft(new MarketService.Draft(item.slot(),item.expected(),Math.clamp(offered,1,item.expected().getCount()),item.want(),Math.clamp(minimum,1,Math.min(4096,36*item.want().getMaxStackSize()))),Math.clamp(duration,AuctionService.MIN_DURATION,AuctionService.MAX_DURATION));
                    render(); return;
                }
                if(page==Page.BID && selected!=null) {
                    int maximum=Math.min(4096,36*selected.want().getMaxStackSize());
                    if(slot==23) bid--; else if(slot==25) bid++; else if(slot==32) bid-=8; else if(slot==34) bid+=8;
                    else if(slot==53) {
                        if(bid>maximum) { tell(new MarketService.Result(false,"The highest bid has reached the allowed payment capacity.")); return; }
                        submitted=true; tell(service.bid(owner,selected.id(),bid,selected.revision())); board(owner,market); return;
                    }
                    bid=Math.max(selected.nextBid(),Math.min(maximum,bid)); render(); return;
                }
                if(page==Page.CANCEL && selected!=null && slot==53) {
                    submitted=true; tell(service.cancel(owner,selected.id(),selected.revision())); board(owner,market);
                }
            } finally { if(owner.containerMenu==this) sendAllDataToRemote(); owner.inventoryMenu.broadcastChanges(); }
        }
        private void tell(MarketService.Result result) { owner.sendSystemMessage(Component.literal(result.message()).withStyle(result.success()?ChatFormatting.GREEN:ChatFormatting.RED)); }
        private void refresh() {
            service.settleExpired();
            if(page==Page.BOARD || page==Page.MINE) entries=service.active().stream().filter(v->page!=Page.MINE || v.seller().equals(owner.getUUID())).toList();
            pages=Math.max(1,(entries.size()+44)/45); number=Math.min(number,pages-1); render();
        }
        private void render() {
            display.clearContent(); for(int i=45;i<54;i++) display.setItem(i,icon(GRAY," "));
            display.setItem(45,icon(Items.ARROW,page==Page.CREATE?"Back: choose payment item":"Back / leave unchanged"));
            switch(page) {
                case BOARD,MINE -> {
                    for(int slot=0,index=number*45;slot<45 && index<entries.size();slot++,index++) {
                        AuctionService.Auction auction=entries.get(index);
                        display.setItem(slot,annotate(auction.offer(),"Seller: "+auction.name(),"Payment: "+auction.want().getHoverName().getString()+" (exact components)","Minimum: "+auction.minimum()+" | Highest: "+auction.highest(),"Highest bidder: "+auction.bidderName(),"Remaining: "+remaining(auction,service),"Click to review; refresh for current bids"));
                    }
                    if(entries.isEmpty()) display.setItem(22,icon(Items.PAPER,"No active auctions"));
                    display.setItem(46,icon(GREEN,"Create auction","Choose offered item, then browse payment items by category."));
                    display.setItem(48,icon(Items.BOOK,"My auctions","Cancellation is allowed only before any bid."));
                    display.setItem(49,icon(Items.CLOCK,"Page "+(number+1)+" / "+pages,"Click to refresh bids and remaining time."));
                    display.setItem(52,icon(Items.CHEST,"Collect winnings / payments / refunds","Shared saved claim stacks: "+market.pending(owner.getUUID()).size()));
                    if(number>0) display.setItem(47,icon(Items.ARROW,"Previous")); if(number+1<pages) display.setItem(51,icon(Items.ARROW,"Next"));
                }
                case OFFER -> {
                    for(int slot=0;slot<36;slot++) {
                        int inventorySlot=slot<27?slot+9:slot-27; ItemStack sample=inventorySnapshot.get(inventorySlot);
                        if(!sample.isEmpty()) display.setItem(slot,annotate(sample,"Click to offer this stack","Only final confirmation takes offered items."));
                    }
                    display.setItem(49,icon(Items.PAPER,"Choose offered item above","Next: browse payment items by category."));
                }
                case WANT -> throw new IllegalStateException("Payment items use the shared picker");
                case CREATE -> {
                    MarketService.Draft item=draft.items(); display.setItem(20,item.expected().copyWithCount(item.offered())); display.setItem(24,item.want());
                    display.setItem(19,icon(Items.ARROW,"Offer -1")); display.setItem(21,icon(Items.ARROW,"Offer +1"));
                    display.setItem(28,icon(Items.ARROW,"Offer -8")); display.setItem(30,icon(Items.ARROW,"Offer +8"));
                    display.setItem(23,icon(Items.ARROW,"Minimum bid -1")); display.setItem(25,icon(Items.ARROW,"Minimum bid +1"));
                    display.setItem(32,icon(Items.ARROW,"Minimum bid -8")); display.setItem(34,icon(Items.ARROW,"Minimum bid +8"));
                    display.setItem(37,icon(Items.CLOCK,"Duration -1 minute")); display.setItem(39,icon(Items.CLOCK,"Duration +1 minute"));
                    display.setItem(41,icon(Items.CLOCK,"Duration -1 hour")); display.setItem(43,icon(Items.CLOCK,"Duration +1 hour"));
                    display.setItem(49,icon(Items.PAPER,"Offer "+item.offered()+" | Minimum "+item.count(),"Duration: "+draft.duration()/60_000+" minutes (1 min - 7 days)","Exact payment components; time runs while offline."));
                    display.setItem(53,icon(GREEN,"Confirm auction & escrow","No cancellation after a bid is placed.","No bids: offered items return to saved claims."));
                }
                case BID,CANCEL -> {
                    if(selected==null) break;
                    display.setItem(20,selected.offer()); display.setItem(24,selected.want());
                    display.setItem(49,icon(Items.CLOCK,"Remaining: "+remaining(selected,service),"Minimum: "+selected.minimum()+" | Highest: "+selected.highest(),"Highest bidder: "+selected.bidderName(),"Seller: "+selected.name()));
                    if(page==Page.BID) {
                        display.setItem(23,icon(Items.ARROW,"Bid -1")); display.setItem(25,icon(Items.ARROW,"Bid +1"));
                        display.setItem(32,icon(Items.ARROW,"Bid -8")); display.setItem(34,icon(Items.ARROW,"Bid +8"));
                        int debit=bid-(owner.getUUID().equals(selected.bidder())?selected.highest():0);
                        boolean atCapacity=bid>Math.min(4096,36*selected.want().getMaxStackSize());
                        display.setItem(53,icon(atCapacity?GRAY:GREEN,atCapacity?"Maximum bid reached":"Confirm bid: "+bid+" exact items","Taken now: "+(atCapacity?0:debit)+" exact items.","Outbid payments are returned to saved claims.","The highest bid is binding until auction ends."));
                    } else display.setItem(53,icon(selected.bidder()==null?GREEN:GRAY,selected.bidder()==null?"Confirm cancellation & refund":"Already bid: cannot cancel","Winning items and payment settle at the deadline."));
                }
            }
            broadcastChanges();
        }
    }
    static String remaining(AuctionService.Auction auction,AuctionService service) {
        long seconds=Math.max(0,(auction.deadline()-service.now()+999)/1000);
        return seconds==0?"Ended":seconds>=86400?seconds/86400+"d "+seconds%86400/3600+"h":seconds>=3600?seconds/3600+"h "+seconds%3600/60+"m":seconds/60+"m "+seconds%60+"s";
    }
    private static ItemStack icon(Item item,String name,String... lines) {
        ItemStack stack=new ItemStack(item); stack.set(DataComponents.CUSTOM_NAME,Component.literal(name).withStyle(style->style.withItalic(false).withColor(ChatFormatting.WHITE))); return annotate(stack,lines);
    }
    private static ItemStack annotate(ItemStack item,String... lines) {
        ItemStack copy=item.copy(); List<Component> lore=new ArrayList<>(copy.getOrDefault(DataComponents.LORE,ItemLore.EMPTY).lines());
        if(lore.size()>12) lore=new ArrayList<>(lore.subList(0,12)); for(String line:lines) lore.add(Component.literal(line).withStyle(ChatFormatting.GRAY));
        copy.set(DataComponents.LORE,new ItemLore(lore)); return copy;
    }
}
