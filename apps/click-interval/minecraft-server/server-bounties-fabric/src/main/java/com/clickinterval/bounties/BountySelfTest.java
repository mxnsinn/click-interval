package com.clickinterval.bounties;

import com.clickinterval.bounties.mixin.MinecraftServerAccessor;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import com.mojang.serialization.JsonOps;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.resources.RegistryOps;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.storage.LevelResource;
import java.nio.file.Path;
import java.util.*;

/** Opt-in only: runs exclusively in the disposable test world's native server. */
final class BountySelfTest {
    static void run(MinecraftServer server,BountyService service) {
        try {
            ServerPlayer sponsor=player(server,"BountySponsor"),target=player(server,"BountyTarget"),killer=player(server,"BountyKiller");
            service.onJoin(sponsor); service.onJoin(target); service.onJoin(killer);
            BountyService.Target selected=service.targets(sponsor).stream().filter(t->t.id().equals(target.getUUID())).findFirst().orElseThrow();
            require(service.targets(sponsor).stream().noneMatch(t->t.id().equals(sponsor.getUUID())),"self excluded from targets");
            ItemStack payment=new ItemStack(Items.DIAMOND,12); payment.set(DataComponents.CUSTOM_NAME,Component.literal("Funded diamonds"));
            sponsor.getInventory().setItem(0,payment);
            require(!service.post(sponsor,selected,List.of(new BountyService.Selection(0,new ItemStack(Items.DIAMOND,12),3))).success(),"component mismatch rejected");
            require(!service.post(sponsor,selected,List.of(new BountyService.Selection(0,payment.copyWithCount(11),3))).success(),"stale count rejected");
            require(!service.post(sponsor,selected,List.of(new BountyService.Selection(0,payment,3),new BountyService.Selection(0,payment,3))).success(),"duplicate slot rejected");
            require(!service.post(sponsor,selected,List.of(new BountyService.Selection(36,payment,3))).success(),"equipment slot rejected");
            require(!service.post(sponsor,selected,List.of(new BountyService.Selection(0,payment,0))).success(),"zero count rejected");
            sponsor.gameMode.changeGameModeForPlayer(GameType.CREATIVE);
            require(!service.post(sponsor,selected,List.of(new BountyService.Selection(0,payment,3))).success(),"creative funding rejected"); sponsor.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
            require(payment.getCount()==12,"rejections keep payment");
            BountyService.Result posted=service.post(sponsor,selected,List.of(new BountyService.Selection(0,payment,5)));
            require(posted.success(),"post succeeds: "+posted.message()); require(sponsor.getInventory().getItem(0).getCount()==7,"exact confirmed debit");
            require(service.activeBounties().size()==1 && service.activeBounties().getFirst().rewards().getFirst().getCount()==5,"escrow holds selected amount");
            ItemStack copy=service.activeBounties().getFirst().rewards().getFirst(); copy.setCount(1);
            require(service.activeBounties().getFirst().rewards().getFirst().getCount()==5,"GUI receives defensive copies");
            require(!service.post(sponsor,selected,List.of(new BountyService.Selection(0,sponsor.getInventory().getItem(0),1))).success(),"repeat submit throttled");
            BountyService restarted=new BountyService(server); require(restarted.activeBounties().size()==1,"escrow survives service restart");
            ServerLivingEntityEvents.AFTER_DEATH.invoker().afterDeath(target,target.damageSources().generic());
            require(service.activeBounties().size()==1,"environment death does not claim");
            service.onKill(target,target); require(service.activeBounties().size()==1,"self kill does not claim");
            for(int i=0;i<36;i++) killer.getInventory().setItem(i,new ItemStack(Items.STONE,64));
            service.onKill(target,killer);
            require(service.activeBounties().isEmpty(),"PvP payout removes bounty once"); require(service.pendingRewards(killer.getUUID()).getFirst().getCount()==5,"full inventory keeps pending payout");
            service.onKill(target,killer); require(service.pendingRewards(killer.getUUID()).size()==1,"duplicate death does not pay twice");
            require(!service.claim(killer).success(),"full inventory claim defers safely");
            ItemStack named=new ItemStack(Items.DIAMOND,62); named.set(DataComponents.CUSTOM_NAME,Component.literal("Funded diamonds")); killer.getInventory().setItem(0,named);
            service.onDisconnect(killer); // Clear only the real-time UI spam guard between synthetic actions.
            require(service.claim(killer).success(),"partial fitting claim succeeds"); require(killer.getInventory().getItem(0).getCount()==64,"partial claim respects stack maximum");
            require(service.pendingRewards(killer.getUUID()).getFirst().getCount()==3,"partial overflow saved");
            restarted=new BountyService(server); require(restarted.pendingRewards(killer.getUUID()).getFirst().getCount()==3,"pending survives restart");
            killer.getInventory().setItem(1,ItemStack.EMPTY); require(restarted.claim(killer).success(),"remaining payout claim");
            require(killer.getInventory().getItem(1).getCount()==3 && restarted.pendingRewards(killer.getUUID()).isEmpty(),"no drop or overflow loss");
            require(ItemStack.isSameItemSameComponents(killer.getInventory().getItem(0),killer.getInventory().getItem(1)),"item components preserved through storage and claim");
            require(!restarted.claim(killer).success(),"reward cannot be claimed twice");
            Path ledger=server.getWorldPath(LevelResource.ROOT).resolve("server-bounties/ledger.json");
            BountyStore store=new BountyStore(ledger); JsonObject after=store.state(); JsonArray rewards=new JsonArray();
            rewards.add(ItemStack.CODEC.encodeStart(RegistryOps.create(JsonOps.INSTANCE,server.registryAccess()),new ItemStack(Items.EMERALD,9)).getOrThrow());
            after.getAsJsonObject("pending").add(killer.getUUID().toString(),rewards);
            String marker="ci_bounty_tx:"+UUID.randomUUID(); store.begin(killer.getUUID(),marker,after);
            require(new BountyService(server).pendingRewards(killer.getUUID()).isEmpty(),"crash before native save aborts escrow mutation");
            store=new BountyStore(ledger); store.begin(killer.getUUID(),marker,after); killer.addTag(marker);
            ((MinecraftServerAccessor)server).bounties$playerDataStorage().save(killer);
            restarted=new BountyService(server); require(restarted.pendingRewards(killer.getUUID()).getFirst().getCount()==9,"native persisted marker recovers committed mutation");
            restarted=new BountyService(server); require(restarted.pendingRewards(killer.getUUID()).getFirst().getCount()==9,"recovery is idempotent");
            store=new BountyStore(ledger); JsonObject unpadded=store.state(),padded=unpadded.deepCopy(); padded.addProperty("capacity_test_padding","x".repeat(2*1024*1024)); store.replace(padded);
            BountyService full=new BountyService(server);
            require(!full.post(sponsor,selected,List.of(new BountyService.Selection(0,sponsor.getInventory().getItem(0),1))).success(),"capacity limit rejects new payment");
            require(full.available() && sponsor.getInventory().getItem(0).getCount()==7,"capacity rejection preserves inventory and service availability");
            killer.getInventory().setItem(2,ItemStack.EMPTY); require(full.claim(killer).success(),"reserved ledger capacity keeps existing claims available");
            JsonObject compact=new BountyStore(ledger).state(); compact.remove("capacity_test_padding"); new BountyStore(ledger).replace(compact);
            restarted=new BountyService(server);
            CancellationSelfTest.run(server,restarted);
            restarted=new BountyService(server);
            BountyMenuSelfTest.run(server,restarted);
            ServerBounties.LOGGER.info("SERVER_BOUNTIES_NATIVE_TEST_PASS");
        } catch(Throwable failure) { ServerBounties.LOGGER.error("SERVER_BOUNTIES_NATIVE_TEST_FAIL",failure); }
    }
    static ServerPlayer player(MinecraftServer server,String name) {
        GameProfile profile=new GameProfile(UUID.nameUUIDFromBytes(("BountyTest:"+name).getBytes(java.nio.charset.StandardCharsets.UTF_8)),name);
        ServerPlayer player=new ServerPlayer(server,server.overworld(),profile,ClientInformation.createDefault());
        player.connection=new ServerGamePacketListenerImpl(server,new Connection(PacketFlow.SERVERBOUND),player,CommonListenerCookie.createInitial(profile,false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL); return player;
    }
    private static void require(boolean condition,String message) { if(!condition) throw new IllegalStateException(message); ServerBounties.LOGGER.info("BOUNTY_TEST: {}",message); }
}
