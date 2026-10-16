package com.clickinterval.market;

import com.google.gson.*;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import java.util.*;
import java.util.function.LongSupplier;

/** Timed exact-item bids using the SAME ledger and inventory WAL as the market. */
public final class AuctionService {
    public static final long MIN_DURATION=60_000L,MAX_DURATION=7L*24*60*60*1000;
    public record Draft(MarketService.Draft items,long duration) {}
    public record Auction(UUID id,UUID seller,String name,ItemStack offer,ItemStack want,int minimum,
                          long opened,long deadline,long revision,UUID bidder,String bidderName,int highest,List<ItemStack> payment) {
        public Auction { offer=offer.copy(); want=want.copy(); payment=copy(payment); }
        @Override public ItemStack offer() { return offer.copy(); }
        @Override public ItemStack want() { return want.copy(); }
        @Override public List<ItemStack> payment() { return copy(payment); }
        public int nextBid() { return bidder==null?minimum:highest+1; }
    }
    private record Confirmation(String token,long expires,Draft draft,UUID id,long revision,int amount,boolean cancel) {}
    private final MarketService market;
    private final LongSupplier clock;
    private final Map<UUID,Confirmation> confirmations=new HashMap<>();
    private long observed;
    private long cachedRevision=-1;
    private List<Auction> cached=List.of();
    AuctionService(MarketService market,LongSupplier clock) {
        this.market=market; this.clock=clock; observed=market.store.readState().get("auctionClock").getAsLong();
    }
    public long now() {
        observed=Math.max(observed,Math.max(0,clock.getAsLong())); return observed;
    }
    public boolean clockSafe() {
        long raw=clock.getAsLong(); long floor=Math.max(observed,market.store.readState().get("auctionClock").getAsLong());
        if(raw<0 || raw<floor-5_000L) return false;
        now(); return true;
    }
    public List<Auction> active() {
        if(cachedRevision==market.store.revision()) return cached;
        List<Auction> entries=new ArrayList<>(); for(JsonElement value:market.store.readState().getAsJsonArray("auctions")) entries.add(decode(market,value.getAsJsonObject()));
        entries.sort(Comparator.comparingLong(Auction::deadline).thenComparing(v->v.id().toString()));
        cached=List.copyOf(entries); cachedRevision=market.store.revision(); return cached;
    }
    public Auction find(UUID id) { return active().stream().filter(v->v.id().equals(id)).findFirst().orElse(null); }
    public MarketService.Result stage(ServerPlayer player,Draft draft,UUID id,int amount,boolean cancel) {
        market.checkThread(); if(!market.available()) return fail("Auction storage is unavailable; escrow is preserved.");
        settleExpired(); if(!market.available()) return fail("Auction storage needs recovery.");
        Auction auction=id==null?null:find(id);
        if(draft==null && auction==null) return fail("That auction is no longer active.");
        if(auction!=null && (cancel!=auction.seller().equals(player.getUUID()))) return fail(cancel?"Only the seller may cancel.":"You cannot bid on your own auction.");
        if(cancel && auction!=null && auction.bidder()!=null) return fail("An auction with a bid cannot be cancelled.");
        String token=UUID.randomUUID().toString();
        confirmations.put(player.getUUID(),new Confirmation(token,System.nanoTime()+60_000_000_000L,draft,id,auction==null?0:auction.revision(),amount,cancel));
        String summary=draft!=null?"Auction "+draft.items().offered()+" x "+draft.items().expected().getHoverName().getString()+"; minimum "+draft.items().count()+" x "+draft.items().want().getHoverName().getString()+" (exact components); duration "+draft.duration()/60_000+" minutes"
                :cancel?"Cancel auction and return its offered items to saved claims":"Bid "+amount+" x "+auction.want().getHoverName().getString()+" (exact components) for "+auction.offer().getCount()+" x "+auction.offer().getHoverName().getString()+"; your own raise charges only the difference";
        return new MarketService.Result(true,summary+". Confirm within 60 seconds: /ah confirm "+token);
    }
    public MarketService.Result confirm(ServerPlayer player,String token) {
        market.checkThread(); Confirmation confirmation=confirmations.get(player.getUUID());
        if(confirmation==null || !confirmation.token().equals(token) || System.nanoTime()>confirmation.expires()) return fail("Auction confirmation is invalid or expired. Review again.");
        confirmations.remove(player.getUUID());
        if(confirmation.draft()!=null) return create(player,confirmation.draft());
        return confirmation.cancel()?cancel(player,confirmation.id(),confirmation.revision()):bid(player,confirmation.id(),confirmation.amount(),confirmation.revision());
    }
    public void onDisconnect(ServerPlayer player) { confirmations.remove(player.getUUID()); }
    public MarketService.Result create(ServerPlayer seller,Draft draft) {
        market.checkThread(); String blocked=market.gate(seller); if(blocked!=null) return fail(blocked);
        if(!clockSafe()) return fail("The server clock moved backwards. New auctions and bids pause until the clock catches up; saved claims remain available.");
        settleExpired(); if(!market.available()) return fail("Auction settlement needs storage recovery.");
        if(draft==null || draft.items()==null || draft.duration()<MIN_DURATION || draft.duration()>MAX_DURATION) return fail("Auction duration must be from 1 minute to 7 days.");
        MarketService.Draft items=draft.items(); ItemStack want=items.want();
        if(items.slot()<0 || items.slot()>=36 || items.offered()<1 || items.count()<1 || items.count()>4096 || want.isEmpty() || items.count()>36L*want.getMaxStackSize())
            return fail("Invalid offered amount or minimum bid.");
        ItemStack actual=seller.getInventory().getItem(items.slot());
        if(actual.isEmpty() || !ItemStack.matches(actual,items.expected()) || actual.getCount()>actual.getMaxStackSize() || items.offered()>actual.getCount())
            return fail("Your offered stack changed. Select it again; nothing was taken.");
        List<Auction> active=active();
        if(active.size()>=500 || active.stream().filter(v->v.seller().equals(seller.getUUID())).count()>=30) return fail("Auction limit reached (30 per seller, 500 total).");
        JsonObject next=market.store.state(),auction=new JsonObject(); UUID id=UUID.randomUUID(); long start=now();
        if(start>Long.MAX_VALUE-MAX_DURATION) return fail("Invalid server clock.");
        auction.addProperty("id",id.toString()); auction.addProperty("seller",seller.getUUID().toString()); auction.addProperty("name",seller.getGameProfile().name());
        auction.addProperty("minimum",items.count()); auction.addProperty("opened",start); auction.addProperty("deadline",start+draft.duration()); auction.addProperty("revision",0L);
        try {
            JsonElement offer=market.encode(actual.copyWithCount(items.offered())),wanted=market.encode(want);
            if(MarketStore.bytes(offer)>16384 || MarketStore.bytes(wanted)>16384) return fail("This item has too much custom data for auction escrow.");
            auction.add("offer",offer); auction.add("want",wanted);
        } catch(RuntimeException invalid) { return fail("This item cannot be safely stored without changing its components."); }
        next.getAsJsonArray("auctions").add(auction); markClock(next);
        if(MarketStore.bytes(next)>2*1024*1024) return fail("Auction storage admission limit reached. Existing claims remain available.");
        List<ItemStack> before=MarketService.inventory(seller),after=mutable(before); after.get(items.slot()).shrink(items.offered());
        return market.transact(seller,before,after,next,"Auction created: "+id+". Offered items are escrowed; deadline runs while players are offline.");
    }
    public MarketService.Result bid(ServerPlayer bidder,UUID id,int amount,long expectedRevision) {
        market.checkThread(); String blocked=market.gate(bidder); if(blocked!=null) return fail(blocked);
        if(!clockSafe()) return fail("The server clock moved backwards. New bids are paused; refunds and claims remain available.");
        settleExpired(); if(!market.available()) return fail("Auction storage needs recovery.");
        Auction auction=find(id);
        if(auction==null || now()>=auction.deadline()) return fail("This auction has ended. No bid was taken.");
        if(auction.seller().equals(bidder.getUUID())) return fail("You cannot bid on your own auction.");
        if(auction.revision()!=expectedRevision) return fail("The highest bid changed. Review the auction again; nothing was taken.");
        if(amount<auction.nextBid() || amount>4096 || amount>36L*auction.want().getMaxStackSize()) return fail("Bid must be at least "+auction.nextBid()+" and fit within 36 normal payment stacks.");
        boolean ownRaise=bidder.getUUID().equals(auction.bidder()); int debit=amount-(ownRaise?auction.highest():0);
        List<ItemStack> before=MarketService.inventory(bidder),after=mutable(before),newPayment=new ArrayList<>(); int remaining=debit;
        for(int slot=0;slot<36 && remaining>0;slot++) {
            ItemStack actual=after.get(slot);
            if(actual.isEmpty() || !ItemStack.isSameItemSameComponents(actual,auction.want())) continue;
            if(actual.getCount()>actual.getMaxStackSize()) return fail("Overstacked payment cannot fund a bid.");
            int removed=Math.min(remaining,actual.getCount()); newPayment.add(actual.copyWithCount(removed)); actual.shrink(removed); remaining-=removed;
        }
        if(remaining>0) return fail("You need "+debit+" more of the exact payment item, including every component.");
        JsonObject next=market.store.state();
        if(ownRaise) newPayment.addAll(auction.payment());
        else if(auction.bidder()!=null) market.addPending(next,auction.bidder(),auction.payment());
        JsonObject row=row(next,id); JsonObject highest=new JsonObject(); highest.addProperty("bidder",bidder.getUUID().toString());
        highest.addProperty("name",bidder.getGameProfile().name()); highest.addProperty("amount",amount); JsonArray encoded=new JsonArray();
        for(ItemStack item:pack(newPayment)) encoded.add(market.encode(item)); highest.add("payment",encoded);
        row.add("highest",highest); row.addProperty("revision",Math.addExact(auction.revision(),1)); markClock(next);
        // Preserve headroom for all outstanding payouts; settlement only moves
        // existing item records and reduces row metadata, it never encodes new value.
        if(MarketStore.bytes(next)>5*1024*1024/2) return fail("Bid/refund storage is full. No bid was taken; collect saved claims first.");
        // The server thread serializes bids. Re-read wall time immediately before
        // the inventory WAL; a long calculation must not cross the deadline.
        if(!clockSafe() || now()>=auction.deadline()) { settleExpired(); return fail("The auction expired or the clock changed before payment. No bid was taken."); }
        return market.transact(bidder,before,after,next,"Bid accepted: "+amount+" exact items escrowed. Any previous highest bid is saved for /ah claim.");
    }
    public MarketService.Result cancel(ServerPlayer seller,UUID id,long expectedRevision) {
        market.checkThread(); String blocked=market.gate(seller); if(blocked!=null) return fail(blocked);
        settleExpired(); if(!market.available()) return fail("Auction storage needs recovery.");
        Auction auction=find(id);
        if(auction==null) return fail("This auction already ended.");
        if(!auction.seller().equals(seller.getUUID())) return fail("Only the seller may cancel their auction.");
        if(auction.bidder()!=null || auction.revision()!=expectedRevision) return fail("The auction received a bid or changed; it cannot be cancelled.");
        JsonObject next=market.store.state(); remove(next,id); market.addPending(next,seller.getUUID(),List.of(auction.offer())); markClock(next);
        try { market.store.replace(next); market.noteMutation(seller); return new MarketService.Result(true,"Unbid auction cancelled. Offered items are saved for /ah claim."); }
        catch(Exception failure) { market.disable(failure); return fail("Auction cancellation needs storage recovery; escrow was preserved."); }
    }
    /** Invoked at startup, periodically, and before any auction mutation. Pure
     * ledger moves guarantee offline settlement and exactly one retired UUID. */
    public void settleExpired() {
        market.checkThread(); if(!market.available()) return;
        long now=now(); List<Auction> expired=active().stream().filter(v->now>=v.deadline()).toList(); if(expired.isEmpty()) return;
        JsonObject next=market.store.state();
        for(Auction auction:expired) {
            remove(next,auction.id());
            if(auction.bidder()==null) market.addPending(next,auction.seller(),List.of(auction.offer()));
            else {
                market.addPending(next,auction.bidder(),List.of(auction.offer())); market.addPending(next,auction.seller(),auction.payment());
            }
        }
        markClock(next);
        try { market.store.replace(next); }
        catch(Exception failure) { market.disable(failure); }
    }
    private void markClock(JsonObject state) { state.addProperty("auctionClock",now()); }
    static Auction decode(MarketService market,JsonObject row) {
        UUID bidder=null; String bidderName="None"; int highest=0; List<ItemStack> payment=new ArrayList<>();
        ItemStack wanted=market.decode(row.get("want"));
        if(wanted.getCount()!=1) throw new IllegalArgumentException("Auction template count must be one");
        int capacity=Math.min(4096,36*wanted.getMaxStackSize()),minimum=row.get("minimum").getAsInt();
        if(minimum<1 || minimum>capacity) throw new IllegalArgumentException("Unpayable auction minimum");
        if(row.has("highest")) {
            JsonObject bid=row.getAsJsonObject("highest"); bidder=UUID.fromString(bid.get("bidder").getAsString()); bidderName=bid.get("name").getAsString(); highest=bid.get("amount").getAsInt(); long sum=0;
            for(JsonElement value:bid.getAsJsonArray("payment")) {
                ItemStack item=market.decode(value); if(!ItemStack.isSameItemSameComponents(item,wanted)) throw new IllegalArgumentException("Auction escrow metadata mismatch");
                payment.add(item); sum+=item.getCount();
            }
            if(sum!=highest || highest<minimum || highest>capacity) throw new IllegalArgumentException("Auction escrow does not cover bid");
        }
        return new Auction(UUID.fromString(row.get("id").getAsString()),UUID.fromString(row.get("seller").getAsString()),row.get("name").getAsString(),market.decode(row.get("offer")),wanted,minimum,
                row.get("opened").getAsLong(),row.get("deadline").getAsLong(),row.get("revision").getAsLong(),bidder,bidderName,highest,payment);
    }
    private static JsonObject row(JsonObject state,UUID id) {
        for(JsonElement value:state.getAsJsonArray("auctions")) if(value.getAsJsonObject().get("id").getAsString().equals(id.toString())) return value.getAsJsonObject();
        throw new IllegalStateException("Missing auction row");
    }
    private static void remove(JsonObject state,UUID id) {
        JsonArray keep=new JsonArray(); for(JsonElement value:state.getAsJsonArray("auctions")) if(!value.getAsJsonObject().get("id").getAsString().equals(id.toString())) keep.add(value); state.add("auctions",keep);
    }
    private static List<ItemStack> pack(List<ItemStack> source) {
        List<ItemStack> packed=new ArrayList<>();
        for(ItemStack input:source) {
            ItemStack rest=input.copy();
            for(ItemStack target:packed) if(!rest.isEmpty() && ItemStack.isSameItemSameComponents(target,rest)) {
                int amount=Math.min(rest.getCount(),Math.max(0,target.getMaxStackSize()-target.getCount())); target.grow(amount); rest.shrink(amount);
            }
            if(!rest.isEmpty()) packed.add(rest);
        }
        return packed;
    }
    private static List<ItemStack> mutable(List<ItemStack> items) { List<ItemStack> result=new ArrayList<>(); for(ItemStack item:items) result.add(item.copy()); return result; }
    private static List<ItemStack> copy(List<ItemStack> items) { return List.copyOf(mutable(items)); }
    private static MarketService.Result fail(String message) { return new MarketService.Result(false,message); }
}
