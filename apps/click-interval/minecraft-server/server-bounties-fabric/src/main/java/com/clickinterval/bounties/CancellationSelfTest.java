package com.clickinterval.bounties;

import com.clickinterval.bounties.mixin.MinecraftServerAccessor;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.storage.LevelResource;

import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

/** Native inventory and persisted-WAL regressions; only the explicit disposable
 * test-server flag calls this class. No production tick work or fake players. */
final class CancellationSelfTest {
    static void run(MinecraftServer server,BountyService service) throws Exception {
        ServerPlayer owner=player(server,"CancelOwner"),other=player(server,"CancelOther"),
                target=player(server,"CancelTarget"),killer=player(server,"CancelKiller");
        for(ServerPlayer player:List.of(owner,other,target,killer)) service.onJoin(player);
        BountyService.Target selected=service.targets(owner).stream().filter(t->t.id().equals(target.getUUID())).findFirst().orElseThrow();

        owner.getInventory().setItem(0,diamonds(12));
        UUID first=post(service,owner,selected,0,5);
        require(service.ownedBounties(owner.getUUID()).size()==1,"owner sees individual contribution");
        require(service.ownedBounties(other.getUUID()).isEmpty(),"another player sees no owned contribution");
        BountyService.OwnBounty view=service.ownedBounties(owner.getUUID()).getFirst();
        view.rewards().getFirst().setCount(64);
        require(service.ownedBounties(owner.getUUID()).getFirst().rewards().getFirst().getCount()==5,"owner menu item copies cannot mint escrow");
        require(!service.cancelGroup(other,target.getUUID(),List.of(first)).success(),"stranger cannot cancel guessed bounty ID");
        require(!service.cancelGroup(target,target.getUUID(),List.of(first)).success(),"target cannot cancel bounty on themselves");
        require(!service.cancelGroup(owner,target.getUUID(),List.of(UUID.randomUUID())).success(),"unknown ID cannot create refund");
        require(!service.cancelGroup(owner,target.getUUID(),null).success(),"missing ID cannot create refund");
        require(!service.cancelGroup(owner,target.getUUID(),List.of()).success(),"empty group cannot create refund");
        require(!service.cancelGroup(owner,target.getUUID(),java.util.Arrays.asList(first,null)).success(),"null ID cannot create refund");
        require(owner.getInventory().getItem(0).getCount()==7 && service.ownedBounties(owner.getUUID()).size()==1,"failed cancellation preserves both escrow and inventory");
        require(service.cancelGroup(owner,target.getUUID(),List.of(first)).success(),"owner can cancel their own contribution");
        require(owner.getInventory().getItem(0).getCount()==12 && service.pendingRewards(owner.getUUID()).isEmpty(),"cancel returns exact original item count");
        require(!service.cancelGroup(owner,target.getUUID(),List.of(first)).success(),"repeated cancellation cannot refund twice");
        service.onKill(target,killer);
        require(count(killer,Items.DIAMOND)==0 && owner.getInventory().getItem(0).getCount()==12,"cancel then kill cannot pay both parties");

        owner.getInventory().setItem(0,diamonds(20)); other.getInventory().setItem(0,diamonds(20));
        UUID ownerFirst=post(service,owner,selected,0,5);
        UUID otherId=post(service,other,selected,0,8);
        UUID ownerSecond=post(service,owner,selected,0,3);
        require(service.ownedBounties(owner.getUUID()).size()==2 && service.ownedBountyGroups(owner.getUUID()).size()==1,"repeat funding retains durable IDs but displays one target bounty");
        BountyService.OwnBountyGroup group=service.ownedBountyGroups(owner.getUUID()).getFirst();
        require(group.rewards().size()==1 && group.rewards().getFirst().getCount()==8,"same-component group rewards combine to one accurate stack");
        group.rewards().getFirst().setCount(64);
        require(service.ownedBountyGroups(owner.getUUID()).getFirst().rewards().getFirst().getCount()==8,"group reward copies cannot alter escrow");
        require(!service.cancelGroup(owner,target.getUUID(),List.of(ownerFirst)).success(),"new own contribution invalidates earlier single-payment preview");
        require(!service.cancelGroup(owner,target.getUUID(),List.of(ownerFirst,ownerFirst)).success(),"duplicate group IDs cannot double a refund");
        require(!service.cancelGroup(owner,target.getUUID(),List.of(ownerFirst,ownerSecond,otherId)).success(),"foreign contribution cannot be smuggled into refund");
        require(!service.cancelGroup(owner,other.getUUID(),group.contributionIds()).success(),"preview IDs cannot cancel a different target");
        post(service,other,selected,0,2);
        require(service.cancelGroup(owner,target.getUUID(),group.contributionIds()).success(),"fresh preview removes full own group even if another sponsor adds funding");
        require(service.ownedBounties(owner.getUUID()).isEmpty() && service.ownedBounties(other.getUUID()).size()==2,"group cancellation preserves every other sponsor contribution");
        require(service.activeBounties().stream().filter(b->b.targetId().equals(target.getUUID())).findFirst().orElseThrow().rewards().stream().mapToInt(ItemStack::getCount).sum()==10,"combined target board decreases by only entire own refunded amount");
        UUID repost=post(service,owner,selected,0,2);
        require(!service.cancelGroup(owner,target.getUUID(),group.contributionIds()).success(),"retired group preview cannot consume a later bounty on same target");
        require(service.cancelGroup(owner,target.getUUID(),List.of(repost)).success(),"new bounty needs its own fresh confirmation");
        service.onKill(target,killer);
        require(count(killer,Items.DIAMOND)==10,"kill pays remaining contributions once");
        require(!service.cancelGroup(owner,target.getUUID(),group.contributionIds()).success() && !service.cancelGroup(other,target.getUUID(),List.of(otherId)).success(),"kill then cancellation cannot refund spent contribution");
        service.onKill(target,killer);
        require(count(killer,Items.DIAMOND)==10 && count(owner,Items.DIAMOND)==20 && count(other,Items.DIAMOND)==10,"repeat kill and stale group confirmations conserve all 40 diamonds");

        // An inventory that fills after funding must retain a durable refund,
        // never drop it into the world or silently reactivate the bounty.
        clear(owner); owner.getInventory().setItem(0,diamonds(20));
        UUID overflow=post(service,owner,selected,0,4);
        UUID overflowSecond=post(service,owner,selected,0,6);
        List<UUID> overflowIds=List.of(overflow,overflowSecond);
        service=new BountyService(server);
        require(service.ownedBountyGroups(owner.getUUID()).getFirst().contributionIds().containsAll(overflowIds),"grouped persisted legacy contributions rebuild after service reload without migration");
        for(int slot=0;slot<36;slot++) owner.getInventory().setItem(slot,new ItemStack(Items.STONE,64));
        require(service.cancelGroup(owner,target.getUUID(),overflowIds).success(),"full inventory still permits safe grouped cancellation");
        require(service.ownedBounties(owner.getUUID()).isEmpty() && pending(service,owner)==10,"full refund is pending without active payable bounty");
        service=new BountyService(server);
        require(pending(service,owner)==10 && !service.cancelGroup(owner,target.getUUID(),overflowIds).success(),"pending grouped refund and consumed IDs survive reload");
        owner.getInventory().setItem(0,diamonds(63));
        service.onDisconnect(owner); require(service.claim(owner).success(),"partial refund fits existing matching stack");
        require(owner.getInventory().getItem(0).getCount()==64 && pending(service,owner)==9,"partial refund splits exactly at stack maximum");
        service=new BountyService(server); owner.getInventory().setItem(1,ItemStack.EMPTY);
        require(service.claim(owner).success(),"remaining refund survives second reload");
        require(owner.getInventory().getItem(1).getCount()==9 && ItemStack.isSameItemSameComponents(owner.getInventory().getItem(0),owner.getInventory().getItem(1)),"grouped refund preserves custom item components");
        require(pending(service,owner)==0 && !service.claim(owner).success(),"refund cannot be collected repeatedly");

        clear(owner); ItemStack pick=new ItemStack(Items.DIAMOND_PICKAXE);
        pick.set(DataComponents.CUSTOM_NAME,Component.literal("Original damaged pickaxe")); pick.setDamageValue(137);
        owner.getInventory().setItem(0,pick.copy()); UUID tool=post(service,owner,selected,0,1);
        require(service.cancelGroup(owner,target.getUUID(),List.of(tool)).success() && ItemStack.matches(pick,owner.getInventory().getItem(0)),"unstackable damaged custom tool round-trips without replacement or repair");

        // Recreate the two crash boundaries used by cancel -> claim using the
        // real ledger and the native saved-player transaction marker.
        clear(owner); owner.getInventory().setItem(0,diamonds(10)); UUID crash=post(service,owner,selected,0,5);
        UUID crashSecond=post(service,owner,selected,0,3); List<UUID> crashIds=List.of(crash,crashSecond);
        Path path=server.getWorldPath(LevelResource.ROOT).resolve("server-bounties/ledger.json");
        BountyStore store=new BountyStore(path); JsonObject refunded=refundState(store.state(),crashIds,owner.getUUID());
        store.replace(refunded);
        service=new BountyService(server);
        require(pending(service,owner)==8 && service.ownedBounties(owner.getUUID()).isEmpty(),"crash after grouped escrow-to-refund commit leaves claimable refund only");
        JsonObject claimed=refunded.deepCopy(); claimed.getAsJsonObject("pending").remove(owner.getUUID().toString());
        String marker="ci_bounty_tx:"+UUID.randomUUID(); store=new BountyStore(path); store.begin(owner.getUUID(),marker,claimed);
        service=new BountyService(server);
        require(pending(service,owner)==8 && owner.getInventory().getItem(0).getCount()==2,"crash before grouped refund native save keeps refund pending");
        store=new BountyStore(path); store.begin(owner.getUUID(),marker,claimed);
        owner.getInventory().setItem(0,diamonds(10)); owner.addTag(marker);
        ((MinecraftServerAccessor)server).bounties$playerDataStorage().save(owner);
        service=new BountyService(server);
        require(pending(service,owner)==0 && owner.getInventory().getItem(0).getCount()==10,"crash after native refund save commits without duplicate pending credit");
        service=new BountyService(server);
        require(!service.cancelGroup(owner,target.getUUID(),crashIds).success() && !service.claim(owner).success() && owner.getInventory().getItem(0).getCount()==10,"repeated recovery never refunds consumed group IDs again");
        service.onJoin(owner); // Clear the synthetic, already committed transaction marker.
        clear(owner); owner.getInventory().setItem(0,diamonds(10));
        owner.inventoryMenu.setCarried(new ItemStack(Items.EMERALD,2));
        require(!service.post(owner,selected,List.of(new BountyService.Selection(0,owner.getInventory().getItem(0),3))).success(),"cursor prevents unsafe forced inventory save on post");
        owner.inventoryMenu.setCarried(ItemStack.EMPTY);
        owner.inventoryMenu.getCraftSlots().setItem(0,new ItemStack(Items.OAK_PLANKS,2));
        require(!service.post(owner,selected,List.of(new BountyService.Selection(0,owner.getInventory().getItem(0),3))).success(),"crafting inputs prevent unsafe forced inventory save on post");
        owner.inventoryMenu.getCraftSlots().clearContent();
        UUID cursor=post(service,owner,selected,0,3);
        owner.inventoryMenu.setCarried(new ItemStack(Items.EMERALD,2));
        require(service.cancelGroup(owner,target.getUUID(),List.of(cursor)).success() && pending(service,owner)==3,"cancel with occupied cursor defers refund without losing cursor");
        require(owner.inventoryMenu.getCarried().getCount()==2 && !service.claim(owner).success(),"held items are never saved away or exchanged for refund");
        owner.inventoryMenu.setCarried(ItemStack.EMPTY);
        owner.inventoryMenu.getCraftSlots().setItem(0,new ItemStack(Items.OAK_PLANKS,2));
        require(!service.claim(owner).success() && pending(service,owner)==3,"crafting ingredients defer refund until safely stored");
        owner.inventoryMenu.getCraftSlots().clearContent();
        owner.containerMenu=new net.minecraft.world.inventory.CraftingMenu(91,owner.getInventory());
        require(!service.claim(owner).success() && pending(service,owner)==3,"foreign container defers payout instead of forcing unsafe save");
        owner.containerMenu=owner.inventoryMenu;
        service.onDisconnect(owner); require(service.claim(owner).success() && count(owner,Items.DIAMOND)==10,"deferred refund collects exactly once after unsafe menus clear");
        ServerBounties.LOGGER.info("SERVER_BOUNTIES_CANCELLATION_TEST_PASS");
    }
    private static UUID post(BountyService service,ServerPlayer owner,BountyService.Target target,int slot,int count) {
        service.onDisconnect(owner); // Only bypass UI timing, never ledger authorization.
        var previous=service.ownedBounties(owner.getUUID()).stream().map(BountyService.OwnBounty::id).toList();
        BountyService.Result posted=service.post(owner,target,List.of(new BountyService.Selection(slot,owner.getInventory().getItem(slot),count)));
        require(posted.success(),"fund cancellation fixture: "+posted.message());
        return service.ownedBounties(owner.getUUID()).stream().map(BountyService.OwnBounty::id).filter(id->!previous.contains(id)).findFirst().orElseThrow();
    }
    private static JsonObject refundState(JsonObject state,List<UUID> ids,UUID owner) {
        JsonArray active=new JsonArray(),refund=new JsonArray();
        for(JsonElement value:state.getAsJsonArray("bounties")) {
            JsonObject bounty=value.getAsJsonObject();
            if(ids.contains(UUID.fromString(bounty.get("id").getAsString()))) for(JsonElement reward:bounty.getAsJsonArray("rewards")) refund.add(reward.deepCopy());
            else active.add(bounty);
        }
        require(!refund.isEmpty(),"crash fixture removes active contribution");
        state.add("bounties",active); state.getAsJsonObject("pending").add(owner.toString(),refund); return state;
    }
    private static ServerPlayer player(MinecraftServer server,String name) { return BountySelfTest.player(server,name); }
    private static ItemStack diamonds(int count) { ItemStack stack=new ItemStack(Items.DIAMOND,count); stack.set(DataComponents.CUSTOM_NAME,Component.literal("Cancel fixture diamonds")); return stack; }
    private static int count(ServerPlayer player,net.minecraft.world.item.Item item) { int result=0; for(int slot=0;slot<36;slot++) if(player.getInventory().getItem(slot).is(item)) result+=player.getInventory().getItem(slot).getCount(); return result; }
    private static int pending(BountyService service,ServerPlayer player) { return service.pendingRewards(player.getUUID()).stream().mapToInt(ItemStack::getCount).sum(); }
    private static void clear(ServerPlayer player) { for(int slot=0;slot<36;slot++) player.getInventory().setItem(slot,ItemStack.EMPTY); }
    private static void require(boolean condition,String message) { if(!condition) throw new IllegalStateException(message); ServerBounties.LOGGER.info("BOUNTY_CANCEL_TEST: {}",message); }
}
