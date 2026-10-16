package com.clickinterval.market;

import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.storage.LevelResource;
import java.io.IOException;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/** Called only inside MarketSelfTest's fresh disposable-world guard. */
final class AuctionSelfTest {
    static void run(MinecraftServer server) throws Exception {
        AtomicLong clock=new AtomicLong(System.currentTimeMillis());
        MarketService market=service(server,clock); AuctionService book=market.auctions();
        ServerPlayer seller=player(server,"AuctionSeller"),a=player(server,"AuctionBidA"),b=player(server,"AuctionBidB");
        ItemStack offered=new ItemStack(Items.EMERALD,16); offered.set(DataComponents.CUSTOM_NAME,Component.literal("Exact auction offer"));
        ItemStack money=new ItemStack(Items.DIAMOND,64); money.set(DataComponents.CUSTOM_NAME,Component.literal("Auction money"));
        seller.getInventory().setItem(0,offered.copy()); a.getInventory().setItem(0,money.copy()); b.getInventory().setItem(0,money.copy());
        require(!book.create(seller,draft(seller,3,money,5,59_999)).success(),"sub-minute duration rejected");
        require(!book.create(seller,draft(seller,3,money,5,AuctionService.MAX_DURATION+1)).success(),"beyond-seven-day duration rejected");
        require(!book.create(seller,draft(seller,3,money,2305,60_000)).success(),"unpayable auction minimum rejected");
        require(book.create(seller,draft(seller,3,money,5,60_000)).success(),"auction escrows exact offered amount");
        AuctionService.Auction auction=book.active().getFirst(); UUID id=auction.id();
        require(seller.getInventory().getItem(0).getCount()==13,"creation debits only offered amount");
        market.onDisconnect(seller); require(!book.bid(seller,id,5,0).success(),"seller cannot bid own auction");
        require(!book.bid(a,id,4,0).success(),"bid below minimum rejected");
        a.getInventory().setItem(0,new ItemStack(Items.DIAMOND,64)); require(!book.bid(a,id,5,0).success(),"payment metadata cannot be laundered"); a.getInventory().setItem(0,money.copy());
        require(book.bid(a,id,5,0).success(),"first bid escrowed"); require(a.getInventory().getItem(0).getCount()==59,"first bid exact debit");
        require(!book.bid(b,id,6,0).success() && b.getInventory().getItem(0).getCount()==64,"concurrent stale revision takes nothing");
        market.onDisconnect(a); require(book.bid(a,id,8,1).success(),"own raise accepted");
        require(a.getInventory().getItem(0).getCount()==56 && market.pending(a.getUUID()).isEmpty(),"own raise debits delta and does not refund itself");
        require(book.find(id).payment().stream().mapToInt(ItemStack::getCount).sum()==8,"own raise keeps prior payment plus delta");
        market.onDisconnect(seller); require(!book.cancel(seller,id,2).success(),"seller cannot cancel after any bid");
        require(book.bid(b,id,9,2).success(),"higher different bidder accepted");
        require(b.getInventory().getItem(0).getCount()==55 && count(market,a,money)==8,"outbid exact escrow becomes saved refund");
        market.onDisconnect(a); require(!book.bid(a,id,10,2).success(),"old confirmation cannot replace newer bid");
        clock.set(auction.deadline()-1);
        String token=token(book.stage(a,null,id,10,false));
        for(int slot=0;slot<36;slot++) b.getInventory().setItem(slot,new ItemStack(Items.STONE,64));
        clock.set(auction.deadline());
        require(!book.confirm(a,token).success(),"confirmation exactly at deadline cannot debit");
        require(book.find(id)==null && count(market,b,offered)==3 && count(market,seller,money)==9,"deadline atomically pays winner and seller while offline");
        require(a.getInventory().getItem(0).getCount()==56,"expired bidder keeps all inventory");
        market=service(server,clock); book=market.auctions();
        require(count(market,b,offered)==3 && count(market,seller,money)==9,"restart cannot settle twice");
        require(!market.claim(b).success(),"full winner inventory leaves item saved"); b.getInventory().setItem(1,ItemStack.EMPTY);
        require(market.claim(b).success() && ItemStack.matches(offered.copyWithCount(3),b.getInventory().getItem(1)),"winner claims exact named offer without drops");
        require(market.claim(a).success() && a.getInventory().getItem(0).getCount()==64,"losing bidder collects complete refund");
        require(market.claim(seller).success() && market.pending(seller.getUUID()).isEmpty(),"seller collects exact winning payment");
        market.onDisconnect(seller);
        require(book.create(seller,draft(seller,2,money,4,60_000)).success(),"no-bid fixture created"); UUID noBid=book.active().getFirst().id();
        clock.addAndGet(60_000); market=service(server,clock); book=market.auctions();
        require(book.find(noBid)==null && count(market,seller,offered)==2,"offline deadline returns unbid offer on boot");
        market.onDisconnect(seller); require(book.create(seller,draft(seller,1,money,1,60_000)).success(),"clock rollback fixture created");
        AuctionService.Auction rollback=book.active().getFirst(); clock.addAndGet(-10_000);
        require(!book.clockSafe() && !book.bid(a,rollback.id(),1,0).success(),"backward clock blocks bids");
        market.onDisconnect(seller); require(!book.create(seller,draft(seller,1,money,1,60_000)).success(),"backward clock blocks new auctions");
        require(book.cancel(seller,rollback.id(),0).success(),"unbid owner cancellation remains available during rollback");
        market.onDisconnect(seller); require(market.claim(seller).success(),"saved claims remain available during clock rollback");
        clock.addAndGet(10_000);
        sharedMarketTests(server,market,clock,seller,a,money);
        menuTests(server,clock,money);
        failureTests(server,clock,money);
        // Complete every synthetic auction so the fixture's last service reload
        // has no dangling test-only auctions.
        clock.addAndGet(AuctionService.MAX_DURATION+1); service(server,clock).auctions().settleExpired();
        ServerMarket.LOGGER.info("SERVER_AUCTION_NATIVE_TEST_PASS");
    }
    private static void sharedMarketTests(MinecraftServer server,MarketService market,AtomicLong clock,ServerPlayer seller,ServerPlayer buyer,ItemStack money) throws Exception {
        AuctionService book=market.auctions(); market.onDisconnect(seller);
        require(book.create(seller,draft(seller,1,money,2,60_000)).success(),"shared-ledger active auction created");
        AuctionService.Auction active=book.active().getFirst(); long watermark=market.store.state().get("auctionClock").getAsLong();
        market.onDisconnect(seller); require(market.post(seller,new MarketService.Draft(0,seller.getInventory().getItem(0),1,money,2)).success(),"ordinary market post alongside auction");
        UUID listing=market.listings().stream().filter(v->v.seller().equals(seller.getUUID())).findFirst().orElseThrow().id();
        market.onDisconnect(buyer); require(market.buy(buyer,listing).success(),"ordinary market purchase alongside auction");
        market.onDisconnect(seller); require(market.post(seller,new MarketService.Draft(0,seller.getInventory().getItem(0),1,money,2)).success(),"ordinary cancellation fixture alongside auction");
        listing=market.listings().stream().filter(v->v.seller().equals(seller.getUUID())).findFirst().orElseThrow().id(); market.onDisconnect(seller);
        require(market.cancel(seller,listing).success(),"ordinary cancellation preserves auction ledger"); market.onDisconnect(seller);
        require(market.claim(seller).success(),"ordinary claim preserves auction ledger");
        require(book.find(active.id())!=null && book.find(active.id()).revision()==0 && market.store.state().get("auctionClock").getAsLong()==watermark,"all ordinary mutations preserve auction state and clock");
        market.onDisconnect(seller); require(book.cancel(seller,active.id(),0).success(),"shared-ledger fixture cancels cleanly");
    }
    private static void menuTests(MinecraftServer server,AtomicLong clock,ItemStack money) throws Exception {
        MarketService market=service(server,clock); AuctionService book=market.auctions();
        ServerPlayer seller=player(server,"AuctionMenu"),a=player(server,"AuctionMenuA"),b=player(server,"AuctionMenuB");
        seller.getInventory().setItem(0,new ItemStack(Items.EMERALD,12)); seller.getInventory().setItem(9,money.copy());
        a.getInventory().setItem(0,money.copy()); b.getInventory().setItem(0,money.copy()); List<ItemStack> original=MarketService.inventory(seller);
        for(ContainerInput input:ContainerInput.values()) {
            AuctionMenus.Menu menu=menu(seller,market,AuctionMenus.Page.OFFER,null,null);
            for(int slot:new int[]{0,27,53,54,89,-999}) { menu.clicked(slot,0,input,seller); require(ItemStack.listMatches(original,MarketService.inventory(seller)) && menu.getCarried().isEmpty(),"auction menu mirrors are inert: "+input); }
            require(menu.quickMoveStack(seller,0).isEmpty() && menu.slots.stream().noneMatch(v->v.mayPickup(seller) || v.mayPlace(money)),"auction slots reject all native transfer paths");
        }
        AuctionService.Draft draft=draft(seller,2,money,3,60_000);
        AuctionMenus.Menu closed=menu(seller,market,AuctionMenus.Page.CREATE,draft,null); closed.removed(seller); seller.containerMenu=seller.inventoryMenu;
        closed.clicked(53,0,ContainerInput.PICKUP,seller); require(book.active().isEmpty(),"closed auction draft cannot submit");
        AuctionMenus.Menu create=menu(seller,market,AuctionMenus.Page.CREATE,draft,null);
        for(ContainerInput input:ContainerInput.values()) if(input!=ContainerInput.PICKUP) create.clicked(53,0,input,seller);
        create.clicked(53,1,ContainerInput.PICKUP,seller); require(book.active().isEmpty(),"auction confirmation requires ordinary left click");
        create.clicked(53,0,ContainerInput.PICKUP,seller); create.clicked(53,0,ContainerInput.PICKUP,seller);
        require(book.active().size()==1 && seller.getInventory().getItem(0).getCount()==10,"auction GUI create is single-use");
        AuctionService.Auction auction=book.active().getFirst();
        AuctionMenus.Menu stale=menu(a,market,AuctionMenus.Page.BID,null,auction);
        require(book.bid(b,auction.id(),3,0).success(),"concurrent bidder advances auction revision");
        stale.clicked(53,0,ContainerInput.PICKUP,a); require(a.getInventory().getItem(0).getCount()==64,"stale GUI bid loses no payment");
        AuctionMenus.Menu bid=menu(a,market,AuctionMenus.Page.BID,null,book.find(auction.id()));
        bid.clicked(53,0,ContainerInput.QUICK_MOVE,a); require(a.getInventory().getItem(0).getCount()==64,"shift bid ignored");
        bid.clicked(53,0,ContainerInput.PICKUP,a); bid.clicked(53,0,ContainerInput.PICKUP,a);
        require(a.getInventory().getItem(0).getCount()==60 && book.find(auction.id()).highest()==4,"GUI bid confirms exactly once");
        market.onDisconnect(seller); AuctionMenus.Menu cancel=menu(seller,market,AuctionMenus.Page.CANCEL,null,book.find(auction.id()));
        cancel.clicked(53,0,ContainerInput.PICKUP,seller); require(book.find(auction.id())!=null,"GUI cancellation cannot bypass bid lock");
        market.onDisconnect(b); String token=token(book.stage(b,null,auction.id(),5,false)); book.onDisconnect(b);
        require(!book.confirm(b,token).success(),"auction command confirmation expires on disconnect");
        clock.addAndGet(60_000); book.settleExpired(); bid.clicked(53,0,ContainerInput.PICKUP,a);
        require(book.find(auction.id())==null && count(market,a,new ItemStack(Items.EMERALD))==2,"expired menu cannot replay settled auction");
        // Populate immutable fixture rows directly to exercise pagination without
        // 46 disk inventory saves; every row is valid, uniquely identified escrow.
        JsonObject state=market.store.state();
        for(int i=0;i<46;i++) {
            JsonObject row=new JsonObject(); row.addProperty("id",UUID.randomUUID().toString()); row.addProperty("seller",seller.getUUID().toString()); row.addProperty("name",seller.getGameProfile().name());
            row.add("offer",market.encode(new ItemStack(Items.EMERALD,i+1))); row.add("want",market.encode(money.copyWithCount(1))); row.addProperty("minimum",1);
            row.addProperty("opened",clock.get()); row.addProperty("deadline",clock.get()+60_000); row.addProperty("revision",0); state.getAsJsonArray("auctions").add(row);
        }
        market.store.replace(state); AuctionMenus.Menu board=menu(a,market,AuctionMenus.Page.BOARD,null,null);
        require(board.getContainer().getItem(51).is(Items.ARROW),"auction board paginates after 45 rows");
        board.clicked(51,0,ContainerInput.PICKUP,a); require(board.getContainer().getItem(47).is(Items.ARROW),"second auction page has previous control");
        board.clicked(47,0,ContainerInput.PICKUP,a); require(board.getContainer().getItem(51).is(Items.ARROW),"auction previous page restores navigation");
        clock.addAndGet(60_000); book.settleExpired();
        ServerMarket.LOGGER.info("SERVER_AUCTION_MENU_TEST_PASS");
    }
    private static void failureTests(MinecraftServer server,AtomicLong clock,ItemStack money) throws Exception {
        Path ledger=server.getWorldPath(LevelResource.ROOT).resolve("server-market/ledger.json");
        for(int mode=0;mode<4;mode++) {
            final int failure=mode; MarketService market=service(server,clock);
            ServerPlayer seller=player(server,"AuctionFaultS"+mode),bidder=player(server,"AuctionFaultB"+mode);
            seller.getInventory().setItem(0,new ItemStack(Items.EMERALD,8)); bidder.getInventory().setItem(0,money.copy());
            require(market.auctions().create(seller,draft(seller,2,money,5,60_000)).success(),"fault bid fixture created "+mode);
            UUID id=market.auctions().active().stream().filter(v->v.seller().equals(seller.getUUID())).findFirst().orElseThrow().id();
            market=new MarketService(server,new MarketService.Faults() {
                int writes;
                @Override public void beforeNativeSave() throws IOException { if(failure==0 || failure==3) throw new IOException("TEST auction native save unavailable"); }
                @Override public void beforeMarkerRead() throws IOException { if(failure==1) throw new IOException("TEST auction marker unreadable"); }
                @Override public void beforeLedgerReplace() throws IOException { if(++writes>=2 && (failure==2 || failure==3)) throw new IOException("TEST auction journal finish unavailable"); }
            },clock::get);
            require(!market.auctions().bid(bidder,id,5,0).success(),"injected auction bid fault reported "+mode);
            boolean committed=mode==1 || mode==2;
            require(bidder.getInventory().getItem(0).getCount()==(committed?59:64),"fault bidder inventory agrees with decision "+mode);
            MarketService recovered=service(server,clock); AuctionService.Auction auction=recovered.auctions().find(id);
            require(auction.highest()==(committed?5:0) && auction.payment().stream().mapToInt(ItemStack::getCount).sum()+bidder.getInventory().getItem(0).getCount()==64,"fault restart conserves all bidder items "+mode);
            require(!new MarketStore(ledger).hasTransaction(),"auction recovery clears journal once "+mode);
        }
        // A failed expiry write must retain offer and payment together; retry on
        // restart moves both once and never uses a second inventory transaction.
        MarketService settlement=new MarketService(server,new MarketService.Faults() {
            @Override public void beforeLedgerReplace() throws IOException { throw new IOException("TEST auction settlement unavailable"); }
        },clock::get);
        int active=settlement.auctions().active().size(); clock.addAndGet(60_000); settlement.auctions().settleExpired();
        require(!settlement.available() && new MarketStore(ledger).state().getAsJsonArray("auctions").size()==active,"failed settlement preserves all escrow rows");
        MarketService recovered=service(server,clock); require(recovered.auctions().active().isEmpty(),"startup retries expired settlement once");
        JsonObject once=new MarketStore(ledger).state(); service(server,clock).auctions().settleExpired();
        require(once.equals(new MarketStore(ledger).state()),"settlement replay cannot duplicate payouts");
    }
    private static AuctionService.Draft draft(ServerPlayer seller,int offered,ItemStack payment,int minimum,long duration) {
        return new AuctionService.Draft(new MarketService.Draft(0,seller.getInventory().getItem(0),offered,payment,minimum),duration);
    }
    private static int count(MarketService market,ServerPlayer player,ItemStack sample) { return market.pending(player.getUUID()).stream().filter(v->ItemStack.isSameItemSameComponents(v,sample)).mapToInt(ItemStack::getCount).sum(); }
    private static String token(MarketService.Result result) { require(result.success(),"confirmation stages"); return result.message().substring(result.message().lastIndexOf(' ')+1); }
    private static MarketService service(MinecraftServer server,AtomicLong clock) throws Exception { return new MarketService(server,new MarketService.Faults(){},clock::get); }
    private static AuctionMenus.Menu menu(ServerPlayer player,MarketService service,AuctionMenus.Page page,AuctionService.Draft draft,AuctionService.Auction auction) {
        AuctionMenus.Menu menu=new AuctionMenus.Menu(21,player,service,page,draft,auction); player.containerMenu=menu; return menu;
    }
    private static ServerPlayer player(MinecraftServer server,String name) {
        GameProfile profile=new GameProfile(UUID.nameUUIDFromBytes(("AuctionFixture:"+name).getBytes(java.nio.charset.StandardCharsets.UTF_8)),name);
        ServerPlayer player=new ServerPlayer(server,server.overworld(),profile,ClientInformation.createDefault());
        player.connection=new ServerGamePacketListenerImpl(server,new Connection(PacketFlow.SERVERBOUND),player,CommonListenerCookie.createInitial(profile,false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL); return player;
    }
    private static void require(boolean condition,String message) { if(!condition) throw new IllegalStateException("AUCTION TEST: "+message); ServerMarket.LOGGER.info("AUCTION_TEST: {}",message); }
}
