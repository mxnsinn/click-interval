package com.clickinterval.market;

import com.clickinterval.market.mixin.MinecraftServerAccessor;
import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import net.minecraft.nbt.*;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.RegistryOps;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.storage.LevelResource;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;

/** All inventory changes execute synchronously on the server thread. A purchase
 * changes only the buyer's inventory; the seller's payment remains in the ledger.
 * Therefore no cross-player two-phase inventory commit is ever required. */
public final class MarketService {
    public record Result(boolean success,String message) {}
    public record Listing(UUID id,UUID seller,String name,ItemStack offer,ItemStack want,int count) {
        public Listing { offer=offer.copy(); want=want.copy(); }
        @Override public ItemStack offer() { return offer.copy(); }
        @Override public ItemStack want() { return want.copy(); }
    }
    public record Draft(int slot,ItemStack expected,int offered,ItemStack want,int count) {
        public Draft { expected=expected.copy(); want=want.copyWithCount(1); }
        @Override public ItemStack expected() { return expected.copy(); }
        @Override public ItemStack want() { return want.copy(); }
    }
    private record Confirmation(String token,long expires,Draft draft,UUID listing,boolean cancel) {}
    private final MinecraftServer server;
    final MarketStore store;
    private final RegistryOps<JsonElement> ops;
    /** Package-private, deterministic fault seams used only by the guarded native fixture. */
    interface Faults {
        default void beforeLedgerReplace() throws IOException {}
        default void beforeNativeSave() throws IOException {}
        default void beforeMarkerRead() throws IOException {}
    }
    private final Faults faults;
    private final AuctionService auctions;
    private final Map<UUID,Confirmation> confirmations=new HashMap<>();
    private final Map<UUID,Long> lastMutation=new HashMap<>();
    private boolean healthy=true;
    private long cachedRevision=-1;
    private List<Listing> cachedListings=List.of();
    public MarketService(MinecraftServer server) throws IOException {
        this(server,new Faults(){});
    }
    MarketService(MinecraftServer server,Faults faults) throws IOException {
        this(server,faults,System::currentTimeMillis);
    }
    MarketService(MinecraftServer server,Faults faults,java.util.function.LongSupplier clock) throws IOException {
        this.faults=faults;
        this.server=server; ops=RegistryOps.create(JsonOps.INSTANCE,server.registryAccess());
        store=new MarketStore(server.getWorldPath(LevelResource.ROOT).resolve("server-market/ledger.json"),faults::beforeLedgerReplace);
        // Validate both sides BEFORE rewriting a recovered journal.
        validateItems(store.state()); validateItems(store.preparedState()); store.recover(this::savedMarker);
        auctions=new AuctionService(this,clock); auctions.settleExpired();
    }
    public AuctionService auctions() { return auctions; }
    public boolean available() { return healthy && !store.hasTransaction(); }
    public List<Listing> listings() {
        if(cachedRevision!=store.revision()) {
            List<Listing> entries=new ArrayList<>();
            for(JsonElement value:store.readState().getAsJsonArray("listings")) entries.add(listing(value.getAsJsonObject()));
            cachedListings=List.copyOf(entries); cachedRevision=store.revision();
        }
        return cachedListings;
    }
    public Listing find(UUID id) { return listings().stream().filter(v->v.id().equals(id)).findFirst().orElse(null); }
    public List<ItemStack> pending(UUID id) {
        JsonArray array=store.readState().getAsJsonObject("pending").getAsJsonArray(id.toString());
        if(array==null) return List.of(); List<ItemStack> items=new ArrayList<>();
        for(JsonElement value:array) items.add(decode(value)); return List.copyOf(items);
    }
    public Result stage(ServerPlayer player,Draft draft,UUID id,boolean cancel) {
        checkThread(); if(!available()) return fail("Market storage is unavailable. No items were changed.");
        Listing listing=id==null?null:find(id);
        if(draft==null && listing==null) return fail("That listing is no longer available.");
        if(listing!=null && (cancel!=listing.seller().equals(player.getUUID())))
            return fail(cancel?"Only the seller can cancel this listing.":"You cannot buy your own listing.");
        String token=UUID.randomUUID().toString();
        confirmations.put(player.getUUID(),new Confirmation(token,System.nanoTime()+60_000_000_000L,draft,id,cancel));
        String summary=draft!=null?"Offer "+draft.offered()+" x "+draft.expected().getHoverName().getString()+" for "+draft.count()+" x "+draft.want().getHoverName().getString()
                :cancel?"Cancel your listing "+id:"Pay "+listing.count()+" x "+listing.want().getHoverName().getString()+" for "+listing.offer().getCount()+" x "+listing.offer().getHoverName().getString();
        return new Result(true,summary+" (exact components). Confirm within 60 seconds: /market confirm "+token);
    }
    public Result confirm(ServerPlayer player,String token) {
        checkThread(); Confirmation confirmation=confirmations.get(player.getUUID());
        if(confirmation==null || !confirmation.token().equals(token) || System.nanoTime()>confirmation.expires())
            return fail("Confirmation is invalid or expired. Review the listing again.");
        confirmations.remove(player.getUUID()); // Consume before any side effect; replay is inert.
        return confirmation.draft()!=null?post(player,confirmation.draft()):confirmation.cancel()?cancel(player,confirmation.listing()):buy(player,confirmation.listing());
    }
    public Result post(ServerPlayer seller,Draft draft) {
        checkThread(); String blocked=gate(seller); if(blocked!=null) return fail(blocked);
        if(draft==null || draft.slot()<0 || draft.slot()>=36 || draft.offered()<1 || draft.count()<1 || draft.count()>4096)
            return fail("Invalid amounts or inventory selection.");
        ItemStack actual=seller.getInventory().getItem(draft.slot()),want=draft.want();
        if(actual.isEmpty() || !ItemStack.matches(actual,draft.expected()) || actual.getCount()>actual.getMaxStackSize() || draft.offered()>actual.getCount())
            return fail("The offered inventory stack changed. Select it again; nothing was taken.");
        if(want.isEmpty() || draft.count()>36L*want.getMaxStackSize()) return fail("The requested payment cannot fit in a normal inventory.");
        if(store.readState().getAsJsonArray("listings").size()>=500 || listings().stream().filter(v->v.seller().equals(seller.getUUID())).count()>=30)
            return fail("Listing limit reached (30 per seller, 500 total). Cancel or finish existing listings first.");
        JsonObject next=store.state(),entry=new JsonObject(); UUID id=UUID.randomUUID();
        entry.addProperty("id",id.toString()); entry.addProperty("seller",seller.getUUID().toString());
        entry.addProperty("name",seller.getGameProfile().name()); entry.addProperty("count",draft.count());
        try {
            JsonElement encodedOffer=encode(actual.copyWithCount(draft.offered())),encodedWant=encode(want);
            if(MarketStore.bytes(encodedOffer)>16384 || MarketStore.bytes(encodedWant)>16384) return fail("This item has too much custom data for market escrow.");
            entry.add("offer",encodedOffer); entry.add("want",encodedWant);
        } catch(RuntimeException invalid) { return fail("This item cannot be stored without changing its components. Nothing was taken."); }
        next.getAsJsonArray("listings").add(entry);
        if(MarketStore.bytes(next)>2*1024*1024) return fail("Market storage is full. Existing claims remain available.");
        List<ItemStack> before=inventory(seller),after=copy(before); after.get(draft.slot()).shrink(draft.offered());
        return transact(seller,before,after,next,"Listing created: "+id+". Your offered items are now held safely in escrow.");
    }
    public Result buy(ServerPlayer buyer,UUID id) {
        checkThread(); String blocked=gate(buyer); if(blocked!=null) return fail(blocked);
        Listing listing=find(id); if(listing==null) return fail("That listing was bought or cancelled. No payment was taken.");
        if(listing.seller().equals(buyer.getUUID())) return fail("You cannot buy your own listing.");
        List<ItemStack> before=inventory(buyer),after=copy(before),payment=new ArrayList<>();
        int remaining=listing.count(); ItemStack wanted=listing.want();
        for(int slot=0;slot<36 && remaining>0;slot++) {
            ItemStack actual=after.get(slot);
            if(actual.isEmpty() || !ItemStack.isSameItemSameComponents(actual,wanted)) continue;
            if(actual.getCount()>actual.getMaxStackSize()) return fail("Overstacked payment items cannot be traded.");
            int amount=Math.min(remaining,actual.getCount()); payment.add(actual.copyWithCount(amount)); actual.shrink(amount); remaining-=amount;
        }
        if(remaining>0) return fail("You need "+listing.count()+" of the exact wanted item, including its name, damage and every component.");
        if(!insert(after,listing.offer()).isEmpty()) return fail("Not enough inventory space after payment. Make room; nothing was taken.");
        JsonObject next=store.state(); remove(next,id); addPending(next,listing.seller(),payment);
        if(MarketStore.bytes(next)>MarketStore.MAX_STATE_BYTES) return fail("Market storage capacity prevents this purchase. No payment was taken; existing claims remain available.");
        return transact(buyer,before,after,next,"Purchase complete. The seller's exact payment is saved for collection.");
    }
    public Result cancel(ServerPlayer seller,UUID id) {
        checkThread(); String blocked=gate(seller); if(blocked!=null) return fail(blocked);
        Listing listing=find(id);
        if(listing==null) return fail("That listing is already gone.");
        if(!listing.seller().equals(seller.getUUID())) return fail("Only the seller can cancel this listing.");
        JsonObject next=store.state(); remove(next,id); addPending(next,seller.getUUID(),List.of(listing.offer()));
        try {
            store.replace(next); lastMutation.put(seller.getUUID(),System.nanoTime());
            return new Result(true,"Listing cancelled. Its exact items are saved; use /market claim to collect your refund.");
        } catch(Exception failure) { disable(failure); return fail("Market save failed. Escrow was preserved; contact the server owner."); }
    }
    public Result claim(ServerPlayer player) {
        checkThread(); String blocked=gate(player); if(blocked!=null) return fail(blocked);
        List<ItemStack> rewards=pending(player.getUUID()); if(rewards.isEmpty()) return fail("No market proceeds or refunds are waiting.");
        List<ItemStack> before=inventory(player),after=copy(before),remaining=new ArrayList<>(); int inserted=0;
        for(ItemStack reward:rewards) {
            ItemStack rest=insert(after,reward); inserted+=reward.getCount()-rest.getCount(); if(!rest.isEmpty()) remaining.add(rest);
        }
        if(inserted==0) return fail("Your inventory is full. Everything stays saved until you have space.");
        JsonObject next=store.state(); next.getAsJsonObject("pending").remove(player.getUUID().toString()); addPending(next,player.getUUID(),remaining);
        return transact(player,before,after,next,remaining.isEmpty()?"All market proceeds and refunds collected.":"Items collected. The remainder stays saved; make room and /market claim again.");
    }
    Result transact(ServerPlayer player,List<ItemStack> before,List<ItemStack> after,JsonObject next,String message) {
        String marker=MarketStore.MARKER_PREFIX+UUID.randomUUID(); boolean begun=false,applied=false;
        try {
            if(!safeInventory(player)) return fail("Empty your cursor and crafting grid, then close other containers first.");
            removeMarkers(player);
            if(!player.addTag(marker)) return fail("Your player data has too many tags. No items were changed.");
            store.begin(player.getUUID(),marker,next); begun=true;
            apply(player,after); applied=true;
            faults.beforeNativeSave();
            ((MinecraftServerAccessor)server).market$playerDataStorage().save(player);
            if(!savedMarker(player.getUUID(),marker)) throw new IOException("Native save did not persist market marker");
            store.finish(true); player.removeTag(marker); sync(player);
            lastMutation.put(player.getUUID(),System.nanoTime()); return new Result(true,message);
        } catch(Exception failure) {
            if(!begun) {
                player.removeTag(marker);
                if(store.hasTransaction()) disable(failure);
                return fail("Could not safely prepare market storage. No items were changed.");
            }
            try {
                if(savedMarker(player.getUUID(),marker)) {
                    store.finish(true); player.removeTag(marker); sync(player);
                    lastMutation.put(player.getUUID(),System.nanoTime()); return new Result(true,message);
                }
                if(applied) apply(player,before);
                player.removeTag(marker); store.finish(false); sync(player);
                return fail("Could not safely save this transaction. Your items were restored.");
            } catch(Exception recovery) {
                failure.addSuppressed(recovery); disable(failure);
                // Preserve the WAL and the matching in-memory inventory/marker.
                // Native disconnect saves this exact state; startup recovery then
                // resolves it before any listing or claim becomes available.
                player.connection.disconnect(Component.literal("Market storage needs recovery. Your transaction journal is preserved; contact the server owner."));
                return fail("Market storage needs recovery. The transaction journal was preserved.");
            }
        }
    }
    private boolean savedMarker(UUID player,String marker) throws IOException {
        faults.beforeMarkerRead();
        Path path=server.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(player+".dat");
        MarketStore.rejectLinks(path);
        if(Files.notExists(path)) return false;
        if(!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS) || Files.size(path)>32L*1024*1024) throw new IOException("Unsafe player save");
        try(FileChannel channel=FileChannel.open(path,StandardOpenOption.WRITE)) { channel.force(true); }
        CompoundTag data=NbtIo.readCompressed(path,NbtAccounter.create(64L*1024*1024));
        return data.getListOrEmpty("Tags").stream().anyMatch(tag->tag instanceof StringTag text && text.value().equals(marker));
    }
    public void onJoin(ServerPlayer player) {
        if(!available()) return; removeMarkers(player);
        if(!pending(player.getUUID()).isEmpty()) player.sendSystemMessage(Component.literal("You have saved market items. Open /market or use /market claim."));
    }
    public void onDisconnect(ServerPlayer player) { confirmations.remove(player.getUUID()); auctions.onDisconnect(player); lastMutation.remove(player.getUUID()); }
    String gate(ServerPlayer player) {
        if(!available()) return "Market storage is temporarily unavailable. Your escrow is preserved.";
        if(!player.isAlive() || player.isRemoved() || player.isCreative() || player.isSpectator()) return "Use the market while alive in Survival or Adventure mode.";
        if(!safeInventory(player)) return "Empty your cursor and crafting grid, then close other containers first.";
        Long last=lastMutation.get(player.getUUID());
        if(last!=null && System.nanoTime()-last<500_000_000L) return "Wait a moment before your next market transaction.";
        return null;
    }
    private static boolean safeInventory(ServerPlayer player) {
        return player.inventoryMenu.getCarried().isEmpty() && player.containerMenu.getCarried().isEmpty()
                && player.inventoryMenu.getInputGridSlots().stream().noneMatch(net.minecraft.world.inventory.Slot::hasItem)
                && (player.containerMenu==player.inventoryMenu || player.containerMenu instanceof MarketMenus.Menu || player.containerMenu instanceof AuctionMenus.Menu);
    }
    private Listing listing(JsonObject row) {
        return new Listing(UUID.fromString(row.get("id").getAsString()),UUID.fromString(row.get("seller").getAsString()),row.get("name").getAsString(),decode(row.get("offer")),decode(row.get("want")),row.get("count").getAsInt());
    }
    private void validateItems(JsonObject state) throws IOException {
        try {
            for(JsonElement value:state.getAsJsonArray("listings")) {
                Listing listing=listing(value.getAsJsonObject());
                if(listing.want().getCount()!=1 || listing.count()>36L*listing.want().getMaxStackSize()) throw new IllegalArgumentException("Unpayable listing");
            }
            for(var entry:state.getAsJsonObject("pending").entrySet()) for(JsonElement value:entry.getValue().getAsJsonArray()) decode(value);
            for(JsonElement value:state.getAsJsonArray("auctions")) AuctionService.decode(this,value.getAsJsonObject());
        } catch(RuntimeException invalid) { throw new IOException("Invalid saved item components; market disabled without resetting escrow",invalid); }
    }
    JsonElement encode(ItemStack stack) {
        JsonElement value=ItemStack.CODEC.encodeStart(ops,stack).getOrThrow();
        if(!ItemStack.matches(stack,decode(value))) throw new IllegalArgumentException("Lossy item codec");
        return value;
    }
    ItemStack decode(JsonElement value) {
        ItemStack item=ItemStack.CODEC.parse(ops,value).getOrThrow();
        if(item.isEmpty() || item.getCount()<1 || item.getCount()>item.getMaxStackSize()) throw new IllegalArgumentException("Invalid escrow stack");
        return item;
    }
    void addPending(JsonObject state,UUID owner,List<ItemStack> additions) {
        if(additions.isEmpty()) return;
        JsonObject pending=state.getAsJsonObject("pending"); JsonArray items=pending.getAsJsonArray(owner.toString());
        if(items==null) items=new JsonArray(); for(ItemStack item:additions) items.add(encode(item)); pending.add(owner.toString(),items);
    }
    private static void remove(JsonObject state,UUID id) {
        JsonArray remaining=new JsonArray();
        for(JsonElement value:state.getAsJsonArray("listings")) if(!value.getAsJsonObject().get("id").getAsString().equals(id.toString())) remaining.add(value);
        state.add("listings",remaining);
    }
    static ItemStack insert(List<ItemStack> inventory,ItemStack input) {
        ItemStack rest=input.copy();
        for(int pass=0;pass<2 && !rest.isEmpty();pass++) for(int slot=0;slot<36 && !rest.isEmpty();slot++) {
            ItemStack target=inventory.get(slot);
            if(pass==0 && !target.isEmpty() && ItemStack.isSameItemSameComponents(target,rest)) {
                int amount=Math.min(rest.getCount(),Math.max(0,target.getMaxStackSize()-target.getCount())); target.grow(amount); rest.shrink(amount);
            } else if(pass==1 && target.isEmpty()) {
                int amount=Math.min(rest.getCount(),rest.getMaxStackSize()); inventory.set(slot,rest.copyWithCount(amount)); rest.shrink(amount);
            }
        }
        return rest;
    }
    static List<ItemStack> inventory(ServerPlayer player) {
        List<ItemStack> copy=new ArrayList<>(); for(int slot=0;slot<36;slot++) copy.add(player.getInventory().getItem(slot).copy()); return copy;
    }
    private static List<ItemStack> copy(List<ItemStack> source) { List<ItemStack> copy=new ArrayList<>(); for(ItemStack item:source) copy.add(item.copy()); return copy; }
    private static void apply(ServerPlayer player,List<ItemStack> items) { for(int i=0;i<36;i++) player.getInventory().setItem(i,items.get(i).copy()); player.getInventory().setChanged(); }
    private static void sync(ServerPlayer player) { player.inventoryMenu.broadcastChanges(); player.containerMenu.broadcastChanges(); }
    private static void removeMarkers(ServerPlayer player) { for(String tag:List.copyOf(player.entityTags())) if(tag.startsWith(MarketStore.MARKER_PREFIX)) player.removeTag(tag); }
    private static Result fail(String message) { return new Result(false,message); }
    void noteMutation(ServerPlayer player) { lastMutation.put(player.getUUID(),System.nanoTime()); }
    void checkThread() { if(!server.isSameThread()) throw new IllegalStateException("Market requires server thread"); }
    void disable(Exception failure) { healthy=false; ServerMarket.LOGGER.error("Market disabled safely. Preserve server-market/ledger.json for recovery.",failure); }
}
