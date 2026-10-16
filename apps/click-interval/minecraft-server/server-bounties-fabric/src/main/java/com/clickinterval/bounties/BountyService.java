package com.clickinterval.bounties;

import com.clickinterval.bounties.mixin.MinecraftServerAccessor;
import com.google.gson.*;
import com.mojang.authlib.GameProfile;
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

/** Event-driven item escrow. All methods run on the server thread; menus contain
 * copies, and only the two-phase confirmed transaction mutates real inventory. */
public final class BountyService {
    public record Target(UUID id,String name,GameProfile profile) {}
    public record BountyView(UUID targetId,String targetName,List<ItemStack> rewards,int sponsors) {
        public BountyView { rewards=copyStacks(rewards); }
        @Override public List<ItemStack> rewards() { return copyStacks(rewards); }
    }
    /** A single sponsor contribution, never the combined bounty on a target. */
    public record OwnBounty(UUID id,UUID targetId,String targetName,List<ItemStack> rewards) {
        public OwnBounty { rewards=copyStacks(rewards); }
        @Override public List<ItemStack> rewards() { return copyStacks(rewards); }
    }
    /** One visible bounty per sponsor and target; underlying payments stay
     * immutable so an old confirmation can never include later funding. */
    public record OwnBountyGroup(UUID targetId,String targetName,List<ItemStack> rewards,List<UUID> contributionIds) {
        public OwnBountyGroup { rewards=copyStacks(rewards); contributionIds=List.copyOf(contributionIds); }
        @Override public List<ItemStack> rewards() { return copyStacks(rewards); }
    }
    public record Selection(int slot,ItemStack expected,int count) {
        public Selection { expected=expected.copy(); }
        @Override public ItemStack expected() { return expected.copy(); }
    }
    public record Result(boolean success,String message) {}
    private static final String MARKER_PREFIX="ci_bounty_tx:";
    private static final int MAX_TARGET_STACKS=128, MAX_REWARD_BYTES=65536;
    private final MinecraftServer server;
    private final BountyStore store;
    private final RegistryOps<JsonElement> ops;
    private final Map<UUID,Long> lastPosts=new HashMap<>();
    private final Map<UUID,Long> lastClaims=new HashMap<>();
    private boolean healthy=true;
    private long cachedRevision=Long.MIN_VALUE;
    private List<Target> cachedTargets;
    private List<BountyView> cachedBoard;
    private final Map<UUID,List<ItemStack>> cachedPending=new HashMap<>();

    public BountyService(MinecraftServer server) throws IOException {
        this.server=server; ops=RegistryOps.create(JsonOps.INSTANCE,server.registryAccess());
        store=new BountyStore(server.getWorldPath(LevelResource.ROOT).resolve("server-bounties/ledger.json"));
        store.recover(this::savedMarker);
        validateItems(store.state());
        importKnownPlayers();
    }
    public boolean available() { return healthy && !store.hasTransaction(); }
    public List<Target> targets(ServerPlayer viewer) {
        invalidateViews();
        if(cachedTargets==null) cachedTargets=buildTargets();
        return cachedTargets.stream().filter(t->!t.id().equals(viewer.getUUID())).toList();
    }
    private List<Target> buildTargets() {
        JsonObject known=store.readState().getAsJsonObject("players"); List<Target> results=new ArrayList<>();
        for (var entry:known.entrySet()) {
            UUID id=UUID.fromString(entry.getKey());
            String name=entry.getValue().getAsString(); ServerPlayer online=server.getPlayerList().getPlayer(id);
            results.add(new Target(id,name,online==null?new GameProfile(id,name):online.getGameProfile()));
        }
        results.sort(Comparator.comparing(Target::name,String.CASE_INSENSITIVE_ORDER).thenComparing(t->t.id().toString()));
        return List.copyOf(results);
    }
    public List<BountyView> activeBounties() {
        invalidateViews(); if(cachedBoard!=null) return cachedBoard;
        JsonObject state=store.readState(); Map<UUID,List<ItemStack>> items=new LinkedHashMap<>(); Map<UUID,Set<String>> sponsors=new HashMap<>();
        for(JsonElement value:state.getAsJsonArray("bounties")) {
            JsonObject bounty=value.getAsJsonObject(); UUID target=UUID.fromString(bounty.get("target").getAsString());
            items.computeIfAbsent(target,k->new ArrayList<>()).addAll(decode(bounty.getAsJsonArray("rewards")));
            sponsors.computeIfAbsent(target,k->new HashSet<>()).add(bounty.get("sponsor").getAsString());
        }
        List<BountyView> result=new ArrayList<>();
        for(var entry:items.entrySet()) result.add(new BountyView(entry.getKey(),name(state,entry.getKey()),entry.getValue(),sponsors.get(entry.getKey()).size()));
        result.sort(Comparator.comparing(BountyView::targetName,String.CASE_INSENSITIVE_ORDER)); cachedBoard=List.copyOf(result); return cachedBoard;
    }
    public List<ItemStack> pendingRewards(UUID player) {
        invalidateViews(); List<ItemStack> cached=cachedPending.get(player); if(cached!=null) return copyStacks(cached);
        JsonArray items=store.readState().getAsJsonObject("pending").getAsJsonArray(player.toString());
        List<ItemStack> result=items==null?List.of():copyStacks(decode(items)); cachedPending.put(player,result); return copyStacks(result);
    }
    List<OwnBounty> ownedBounties(UUID sponsor) {
        checkThread();
        List<OwnBounty> result=new ArrayList<>(); JsonObject state=store.readState();
        for(JsonElement value:state.getAsJsonArray("bounties")) {
            JsonObject bounty=value.getAsJsonObject();
            if(!UUID.fromString(bounty.get("sponsor").getAsString()).equals(sponsor)) continue;
            UUID target=UUID.fromString(bounty.get("target").getAsString());
            result.add(new OwnBounty(UUID.fromString(bounty.get("id").getAsString()),target,name(state,target),decode(bounty.getAsJsonArray("rewards"))));
        }
        result.sort(Comparator.comparing(OwnBounty::targetName,String.CASE_INSENSITIVE_ORDER).thenComparing(b->b.id().toString()));
        return List.copyOf(result);
    }
    public List<OwnBountyGroup> ownedBountyGroups(UUID sponsor) {
        Map<UUID,List<OwnBounty>> groups=new LinkedHashMap<>();
        for(OwnBounty bounty:ownedBounties(sponsor)) groups.computeIfAbsent(bounty.targetId(),id->new ArrayList<>()).add(bounty);
        List<OwnBountyGroup> result=new ArrayList<>();
        for(var group:groups.entrySet()) {
            List<ItemStack> rewards=new ArrayList<>(); List<UUID> ids=new ArrayList<>();
            for(OwnBounty bounty:group.getValue()) { rewards.addAll(bounty.rewards()); ids.add(bounty.id()); }
            result.add(new OwnBountyGroup(group.getKey(),group.getValue().getFirst().targetName(),combinedStacks(rewards),ids));
        }
        return List.copyOf(result);
    }
    /** Cancels all of this sponsor's funding on one target only when the exact
     * current contribution-ID set equals the set shown in their confirmation.
     * Other sponsors are outside that set. Later funding, a completed kill, or
     * a stale/replayed menu fails closed without moving any item. */
    public Result cancelGroup(ServerPlayer sponsor,UUID targetId,List<UUID> previewIds) {
        checkThread();
        if(!available()) return fail("Bounties are temporarily unavailable. No bounty or items were changed.");
        if(targetId==null || previewIds==null || previewIds.isEmpty() || previewIds.size()>500 || previewIds.stream().anyMatch(Objects::isNull))
            return fail("Reopen My bounties to review the bounty before removing it.");
        Set<UUID> expected=new HashSet<>(previewIds);
        if(expected.size()!=previewIds.size()) return fail("Invalid bounty confirmation. No items were changed.");
        JsonObject next=store.state(); JsonArray survivors=new JsonArray(),selected=new JsonArray(); Set<UUID> current=new HashSet<>();
        for(JsonElement value:next.getAsJsonArray("bounties")) {
            JsonObject bounty=value.getAsJsonObject();
            if(UUID.fromString(bounty.get("target").getAsString()).equals(targetId)
                    && UUID.fromString(bounty.get("sponsor").getAsString()).equals(sponsor.getUUID())) {
                selected.add(bounty); current.add(UUID.fromString(bounty.get("id").getAsString()));
            }
            else survivors.add(value);
        }
        if(current.isEmpty()) return fail("You have no active bounty on that player. You can only remove bounties you funded.");
        if(!current.equals(expected)) return fail("Your bounty changed since the preview. Nothing was removed; reopen My bounties to review it again.");
        next.add("bounties",survivors);
        JsonObject pending=next.getAsJsonObject("pending"); String owner=sponsor.getUUID().toString();
        JsonArray refund=pending.getAsJsonArray(owner); if(refund==null) refund=new JsonArray();
        for(JsonElement contribution:selected) for(JsonElement reward:contribution.getAsJsonObject().getAsJsonArray("rewards")) refund.add(reward.deepCopy());
        pending.add(owner,refund);
        try {
            // Commit escrow -> refund before touching inventory. A crash here
            // leaves a pending refund, not a still-payable active bounty.
            store.replace(next);
        } catch(Exception failure) {
            disable(failure); return fail("Could not safely save the removal. Your bounty items remain protected in storage.");
        }
        try {
            Result delivered=claim(sponsor,true);
            return new Result(true,"Your bounty was removed. "+delivered.message());
        } catch(Exception failure) {
            disable(failure);
            return new Result(true,"Your bounty was removed and the refund is saved. Bounty storage needs recovery before collection.");
        }
    }
    public Result post(ServerPlayer sponsor,Target target,List<Selection> selections) {
        checkThread();
        if(!available()) return fail("Bounties are temporarily unavailable; no payment was taken.");
        if(!sponsor.isAlive() || sponsor.isSpectator() || sponsor.isCreative()) return fail("Use Survival or Adventure mode to fund a bounty.");
        if(!safeInventoryTransaction(sponsor)) return fail("Put away your held item, empty the crafting grid, and close other containers before funding a bounty.");
        if(target==null || target.id().equals(sponsor.getUUID())) return fail("Choose another player.");
        JsonObject next=store.state();
        if(!next.getAsJsonObject("players").has(target.id().toString())) return fail("That player is not in this server's player list.");
        if(selections==null || selections.isEmpty() || selections.size()>36) return fail("Select at least one inventory item.");
        if(next.getAsJsonArray("bounties").size()>=500) return fail("The bounty board is full; try again after some are claimed.");
        long now=System.nanoTime(); Long previous=lastPosts.get(sponsor.getUUID());
        if(previous!=null && now-previous<2_000_000_000L) return fail("Wait a moment before posting another bounty.");
        List<ItemStack> before=inventory(sponsor),after=copyMutable(before),rewards=new ArrayList<>(); Set<Integer> slots=new HashSet<>();
        for(Selection selected:selections) {
            if(selected==null || selected.slot()<0 || selected.slot()>=36 || !slots.add(selected.slot())) return fail("Invalid reward selection; reopen the reward menu.");
            ItemStack actual=before.get(selected.slot()),expected=selected.expected();
            if(actual.isEmpty() || selected.count()<1 || selected.count()>actual.getCount()
                    || actual.getCount()!=expected.getCount() || !ItemStack.isSameItemSameComponents(actual,expected))
                return fail("Your inventory changed. Reopen the reward menu and select the reward again.");
            if(actual.getCount()>actual.getMaxStackSize()) return fail("Overstacked items cannot fund a bounty.");
            rewards.add(actual.copyWithCount(selected.count())); after.get(selected.slot()).shrink(selected.count());
        }
        int existing=0;
        for(JsonElement value:next.getAsJsonArray("bounties")) {
            JsonObject b=value.getAsJsonObject(); if(b.get("target").getAsString().equals(target.id().toString())) existing+=b.getAsJsonArray("rewards").size();
        }
        if(existing+rewards.size()>MAX_TARGET_STACKS) return fail("That player's bounty has reached its item limit.");
        JsonArray encoded;
        try { encoded=encode(rewards); }
        catch(RuntimeException invalidItem) { return fail("One selected item cannot be safely stored. No payment was taken."); }
        if(encoded.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>MAX_REWARD_BYTES) return fail("Those items contain too much custom data for a bounty.");
        JsonObject bounty=new JsonObject(); bounty.addProperty("id",UUID.randomUUID().toString());
        bounty.addProperty("target",target.id().toString()); bounty.addProperty("sponsor",sponsor.getUUID().toString()); bounty.add("rewards",encoded);
        next.getAsJsonArray("bounties").add(bounty);
        // New escrow stops below the storage limit, reserving 1 MiB for all
        // future known-player records and payout bookkeeping, never stranding claims.
        if(next.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>2*1024*1024)
            return fail("The bounty board has reached its storage budget. Existing rewards can still be claimed.");
        Result result=transact(sponsor,before,after,next,"Bounty posted on "+name(next,target.id())+". Your selected items are held as the reward.");
        if(result.success()) lastPosts.put(sponsor.getUUID(),now); return result;
    }
    public Result claim(ServerPlayer player) {
        return claim(player,false);
    }
    private Result claim(ServerPlayer player,boolean automatic) {
        checkThread(); if(!available()) return fail("Bounties are temporarily unavailable. Your rewards remain saved.");
        if(!player.isAlive() || player.isSpectator()) return fail("Claim your rewards after respawning.");
        if(!safeInventoryTransaction(player)) return fail("Your rewards are saved. Put away your held item, empty the crafting grid, and close other containers, then use /bounties claim.");
        long now=System.nanoTime(); Long previous=lastClaims.get(player.getUUID());
        if(!automatic && previous!=null && now-previous<1_000_000_000L) return fail("Wait a moment before collecting again.");
        lastClaims.put(player.getUUID(),now);
        JsonObject next=store.state(); JsonObject pending=next.getAsJsonObject("pending"); JsonArray encoded=pending.getAsJsonArray(player.getUUID().toString());
        if(encoded==null || encoded.isEmpty()) return fail("You have no unclaimed rewards.");
        List<ItemStack> before=inventory(player),after=copyMutable(before),remaining=new ArrayList<>(); int added=0;
        for(ItemStack reward:decode(encoded)) {
            ItemStack rest=reward.copy();
            for(int pass=0;pass<2 && !rest.isEmpty();pass++) for(int slot=0;slot<36 && !rest.isEmpty();slot++) {
                ItemStack dest=after.get(slot);
                if(pass==0 && !dest.isEmpty() && ItemStack.isSameItemSameComponents(dest,rest)) {
                    int n=Math.min(rest.getCount(),Math.max(0,dest.getMaxStackSize()-dest.getCount())); dest.grow(n); rest.shrink(n); added+=n;
                } else if(pass==1 && dest.isEmpty()) {
                    int n=Math.min(rest.getCount(),rest.getMaxStackSize()); after.set(slot,rest.copyWithCount(n)); rest.shrink(n); added+=n;
                }
            }
            if(!rest.isEmpty()) remaining.add(rest);
        }
        if(added==0) return fail("Your inventory is full. Your rewards are saved; make room, then use /bounties claim.");
        if(remaining.isEmpty()) pending.remove(player.getUUID().toString()); else pending.add(player.getUUID().toString(),encode(remaining));
        return transact(player,before,after,next,remaining.isEmpty()?"Bounty rewards added to your inventory.":"Some bounty rewards were added. The rest are saved; make room and use /bounties claim.");
    }
    public void onJoin(ServerPlayer player) {
        checkThread(); if(!available()) return;
        cachedTargets=null;
        try {
            JsonObject next=store.state(); JsonObject players=next.getAsJsonObject("players");
            String key=player.getUUID().toString(),name=player.getGameProfile().name();
            if(!players.has(key) || !players.get(key).getAsString().equals(name)) {
                if(players.size()<10000 || players.has(key)) { players.addProperty(key,name); store.replace(next); }
            }
            removeMarkers(player);
            if(!pendingRewards(player.getUUID()).isEmpty()) player.sendSystemMessage(Component.literal("You have saved bounty rewards. Open /bounties to collect them."));
        } catch(Exception failure) { disable(failure); }
    }
    public void onDisconnect(ServerPlayer player) { lastPosts.remove(player.getUUID()); lastClaims.remove(player.getUUID()); }
    /** Only an actual other-player killing damage source qualifies: no suicide,
     * environmental kill, mob, or stale combat-credit attribution. */
    public void onKill(ServerPlayer victim,ServerPlayer killer) {
        checkThread(); if(!available() || killer==null || killer==victim || killer.getUUID().equals(victim.getUUID()) || killer.isSpectator()) return;
        JsonObject next=store.state(); JsonArray survivors=new JsonArray(); List<ItemStack> winnings=new ArrayList<>();
        for(JsonElement entry:next.getAsJsonArray("bounties")) {
            JsonObject bounty=entry.getAsJsonObject();
            if(bounty.get("target").getAsString().equals(victim.getUUID().toString())) winnings.addAll(decode(bounty.getAsJsonArray("rewards")));
            else survivors.add(entry);
        }
        if(winnings.isEmpty()) return;
        next.add("bounties",survivors); JsonObject pending=next.getAsJsonObject("pending");
        JsonArray all=pending.getAsJsonArray(killer.getUUID().toString()); if(all==null) all=new JsonArray();
        for(JsonElement item:encode(winnings)) all.add(item); pending.add(killer.getUUID().toString(),all);
        try {
            store.replace(next); // Entire payout is one atomic ledger move, before inventory delivery.
            Result result=claim(killer,true); killer.sendSystemMessage(Component.literal("Bounty claimed for "+victim.getGameProfile().name()+". "+result.message()));
        } catch(Exception failure) { disable(failure); }
    }
    private Result transact(ServerPlayer player,List<ItemStack> before,List<ItemStack> after,JsonObject next,String message) {
        if(!safeInventoryTransaction(player)) return fail("Finish your current inventory action before collecting or funding a bounty. No items were changed.");
        String marker=MARKER_PREFIX+UUID.randomUUID(); boolean begun=false,applied=false;
        try {
            removeMarkers(player);
            if(!player.addTag(marker)) return fail("Your player data has too many tags; no items were changed.");
            store.begin(player.getUUID(),marker,next); begun=true;
            applyInventory(player,after); applied=true;
            ((MinecraftServerAccessor)server).bounties$playerDataStorage().save(player);
            if(!savedMarker(player.getUUID(),marker)) throw new IOException("Native player save did not persist the transaction marker");
            store.finish(true);
            player.removeTag(marker); sync(player); return new Result(true,message);
        } catch(Exception failure) {
            if(!begun) { player.removeTag(marker); return fail("Could not safely save the bounty. No items were changed."); }
            try {
                if(savedMarker(player.getUUID(),marker)) {
                    store.finish(true); player.removeTag(marker); sync(player); return new Result(true,message);
                }
                if(applied) applyInventory(player,before);
                player.removeTag(marker); store.finish(false); sync(player);
                return fail("Could not safely save the bounty. Your items were restored.");
            } catch(Exception recoveryFailure) {
                failure.addSuppressed(recoveryFailure); disable(failure);
                // Keep the WAL and marker intact. Disconnect prevents further player
                // inventory transactions; native disconnect saves the same marker.
                player.connection.disconnect(Component.literal("Bounty storage needs recovery. Your items are protected by its transaction journal; contact the server owner."));
                return fail("Bounty storage needs recovery; the transaction journal was preserved.");
            }
        }
    }
    private boolean savedMarker(UUID player,String marker) throws IOException {
        Path path=server.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(player+".dat");
        if(Files.notExists(path)) return false;
        for(Path ancestor=path;ancestor!=null;ancestor=ancestor.getParent()) if(Files.isSymbolicLink(ancestor)) throw new IOException("Linked player save path");
        if(!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS) || Files.size(path)>32L*1024*1024) throw new IOException("Unsafe or unreadable player save file");
        try(FileChannel channel=FileChannel.open(path,StandardOpenOption.WRITE)) { channel.force(true); }
        CompoundTag data=NbtIo.readCompressed(path,NbtAccounter.create(64L*1024*1024));
        return data.getListOrEmpty("Tags").stream().anyMatch(tag->tag instanceof StringTag text && text.value().equals(marker));
    }
    private void importKnownPlayers() throws IOException {
        JsonObject next=store.state(),players=next.getAsJsonObject("players"); Path cache=server.getServerDirectory().resolve("usercache.json");
        if(Files.isRegularFile(cache) && !Files.isSymbolicLink(cache) && Files.size(cache)<=2*1024*1024) {
            try {
                JsonArray entries=JsonParser.parseString(Files.readString(cache)).getAsJsonArray();
                for(JsonElement value:entries) {
                    if(players.size()>=10000) break;
                    try { JsonObject entry=value.getAsJsonObject(); UUID id=UUID.fromString(entry.get("uuid").getAsString()); String name=entry.get("name").getAsString();
                        if(name.matches("[A-Za-z0-9_]{1,16}")) players.addProperty(id.toString(),name);
                    } catch(RuntimeException ignored) { /* A bad cache row never destroys escrow. */ }
                }
            } catch(RuntimeException ignored) { ServerBounties.LOGGER.warn("Ignoring malformed optional usercache.json"); }
        }
        for(ServerPlayer player:server.getPlayerList().getPlayers()) if(players.size()<10000 || players.has(player.getUUID().toString()))
            players.addProperty(player.getUUID().toString(),player.getGameProfile().name());
        if(!next.equals(store.state())) store.replace(next);
    }
    private void validateItems(JsonObject state) throws IOException {
        try {
            for(var entry:state.getAsJsonObject("players").entrySet()) { UUID.fromString(entry.getKey()); if(!entry.getValue().getAsString().matches("[A-Za-z0-9_]{1,16}")) throw new IllegalArgumentException("Invalid stored player name"); }
            Set<UUID> ids=new HashSet<>();
            for(JsonElement value:state.getAsJsonArray("bounties")) { JsonObject bounty=value.getAsJsonObject();
                UUID.fromString(bounty.get("target").getAsString()); UUID.fromString(bounty.get("sponsor").getAsString());
                if(!ids.add(UUID.fromString(bounty.get("id").getAsString()))) throw new IllegalArgumentException("Duplicate bounty ID"); decode(bounty.getAsJsonArray("rewards")); }
            for(var entry:state.getAsJsonObject("pending").entrySet()) { UUID.fromString(entry.getKey()); decode(entry.getValue().getAsJsonArray()); }
        } catch(RuntimeException invalid) { throw new IOException("Invalid saved bounty items; escrow retained and feature disabled",invalid); }
    }
    private JsonArray encode(List<ItemStack> stacks) {
        JsonArray result=new JsonArray(); for(ItemStack stack:stacks) if(!stack.isEmpty()) result.add(ItemStack.CODEC.encodeStart(ops,stack).getOrThrow()); return result;
    }
    private List<ItemStack> decode(JsonArray values) {
        List<ItemStack> result=new ArrayList<>();
        for(JsonElement value:values) { ItemStack stack=ItemStack.CODEC.parse(ops,value).getOrThrow();
            if(stack.isEmpty() || stack.getCount()<1 || stack.getCount()>stack.getMaxStackSize()) throw new IllegalArgumentException("Invalid escrow stack"); result.add(stack); }
        return result;
    }
    private static List<ItemStack> inventory(ServerPlayer player) { List<ItemStack> result=new ArrayList<>(); for(int i=0;i<36;i++) result.add(player.getInventory().getItem(i).copy()); return result; }
    private static boolean safeInventoryTransaction(ServerPlayer player) {
        // Native player saves do not include carried stacks or transient menu
        // inputs. Never force a transaction save while those items are outside
        // the durable player inventory; leave any payout safely pending instead.
        if(!player.inventoryMenu.getCarried().isEmpty() || !player.containerMenu.getCarried().isEmpty()) return false;
        if(player.inventoryMenu.getInputGridSlots().stream().anyMatch(net.minecraft.world.inventory.Slot::hasItem)) return false;
        return player.containerMenu==player.inventoryMenu || player.containerMenu instanceof BountyMenus.Menu;
    }
    private static void applyInventory(ServerPlayer player,List<ItemStack> items) { for(int i=0;i<36;i++) player.getInventory().setItem(i,items.get(i).copy()); player.getInventory().setChanged(); }
    private static void sync(ServerPlayer player) { player.inventoryMenu.broadcastChanges(); player.containerMenu.broadcastChanges(); }
    private static void removeMarkers(ServerPlayer player) { for(String tag:List.copyOf(player.entityTags())) if(tag.startsWith(MARKER_PREFIX)) player.removeTag(tag); }
    private static List<ItemStack> copyMutable(List<ItemStack> items) { List<ItemStack> copy=new ArrayList<>(); for(ItemStack item:items) copy.add(item.copy()); return copy; }
    private static List<ItemStack> combinedStacks(List<ItemStack> items) {
        List<ItemStack> combined=new ArrayList<>();
        for(ItemStack item:items) {
            ItemStack remaining=item.copy();
            for(ItemStack existing:combined) {
                if(remaining.isEmpty()) break;
                if(ItemStack.isSameItemSameComponents(existing,remaining)) {
                    int count=Math.min(remaining.getCount(),Math.max(0,existing.getMaxStackSize()-existing.getCount()));
                    existing.grow(count); remaining.shrink(count);
                }
            }
            if(!remaining.isEmpty()) combined.add(remaining);
        }
        return combined;
    }
    private static List<ItemStack> copyStacks(List<ItemStack> items) { return List.copyOf(copyMutable(items)); }
    private static String name(JsonObject state,UUID id) { JsonElement name=state.getAsJsonObject("players").get(id.toString()); return name==null?id.toString():name.getAsString(); }
    private static Result fail(String message) { return new Result(false,message); }
    private void invalidateViews() {
        if(cachedRevision!=store.revision()) { cachedRevision=store.revision(); cachedTargets=null; cachedBoard=null; cachedPending.clear(); }
    }
    private void checkThread() { if(!server.isSameThread()) throw new IllegalStateException("Bounty inventory changes require the server thread"); }
    private void disable(Exception failure) { healthy=false; ServerBounties.LOGGER.error("Bounty storage disabled safely; preserve server-bounties/ledger.json for recovery",failure); }
}
