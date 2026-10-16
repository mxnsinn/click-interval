package com.clickinterval.market;

import com.clickinterval.market.mixin.MinecraftServerAccessor;
import com.google.gson.*;
import com.mojang.authlib.GameProfile;
import com.mojang.serialization.JsonOps;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.resources.RegistryOps;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.*;
import net.minecraft.world.item.component.ItemContainerContents;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.storage.LevelResource;
import java.nio.file.*;
import java.util.*;

/** Opt-in synthetic players exclusively in a fresh explicitly marked fixture world. */
final class MarketSelfTest {
    static void run(MinecraftServer server,MarketService initial) {
        try {
            Path world=server.getWorldPath(LevelResource.ROOT);
            if(!Files.isRegularFile(world.resolve("server-market-test-fixture"),LinkOption.NOFOLLOW_LINKS)
                    || Files.exists(world.resolve("server-market/ledger.json")))
                throw new IllegalStateException("Refusing native tests without marker AND a fresh market ledger");
            require(initial!=null,"service initializes");
            MarketService service=initial;
            ServerPlayer seller=player(server,"MarketSeller"),buyer=player(server,"MarketBuyer"),other=player(server,"MarketOther");
            ItemStack currency=new ItemStack(Items.DIAMOND,16); currency.set(DataComponents.CUSTOM_NAME,Component.literal("Exact payment"));
            ItemStack sword=new ItemStack(Items.DIAMOND_SWORD); sword.setDamageValue(123); sword.set(DataComponents.CUSTOM_NAME,Component.literal("Escrow blade"));
            sword.enchant(server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(Enchantments.SHARPNESS),3);
            ItemStack box=new ItemStack(Items.SHULKER_BOX); box.set(DataComponents.CUSTOM_NAME,Component.literal("Full escrow box"));
            box.set(DataComponents.CONTAINER,ItemContainerContents.fromItems(List.of(sword)));
            seller.getInventory().setItem(0,box.copy()); buyer.getInventory().setItem(0,currency.copy()); other.getInventory().setItem(0,currency.copy());
            require(!service.post(seller,new MarketService.Draft(0,new ItemStack(Items.SHULKER_BOX),1,currency,5)).success(),"stale metadata rejects listing");
            require(!service.post(seller,new MarketService.Draft(0,box,0,currency,5)).success(),"zero offer rejected");
            require(!service.post(seller,new MarketService.Draft(0,box,1,currency,2305)).success(),"impossible payment capacity rejected");
            seller.gameMode.changeGameModeForPlayer(GameType.CREATIVE);
            require(!service.post(seller,new MarketService.Draft(0,box,1,currency,5)).success(),"creative rejected"); seller.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
            require(service.post(seller,new MarketService.Draft(0,box,1,currency,5)).success(),"exact container listing creates");
            UUID listing=service.listings().getFirst().id();
            require(seller.getInventory().getItem(0).isEmpty(),"offer debited exactly");
            ItemStack view=service.listings().getFirst().offer(); view.set(DataComponents.CUSTOM_NAME,Component.literal("tampered GUI copy"));
            require(ItemStack.matches(box,service.find(listing).offer()),"defensive listing copies");
            require(!service.cancel(buyer,listing).success(),"buyer cannot cancel seller listing");
            reset(service,seller); require(!service.buy(seller,listing).success(),"self purchase rejected");
            buyer.getInventory().setItem(0,new ItemStack(Items.DIAMOND,16));
            require(!service.buy(buyer,listing).success(),"unnamed payment cannot launder named requirement");
            for(int slot=0;slot<36;slot++) buyer.getInventory().setItem(slot,new ItemStack(Items.STONE,64));
            buyer.getInventory().setItem(0,currency.copy());
            require(!service.buy(buyer,listing).success(),"full inventory purchase aborts before debit");
            require(buyer.getInventory().getItem(0).getCount()==16,"failed full purchase conserves payment");
            buyer.getInventory().setItem(1,ItemStack.EMPTY);
            buyer.inventoryMenu.setCarried(new ItemStack(Items.GOLD_INGOT));
            require(!service.buy(buyer,listing).success(),"cursor in flight rejects save transaction"); buyer.inventoryMenu.setCarried(ItemStack.EMPTY);
            require(service.buy(buyer,listing).success(),"purchase commits");
            require(buyer.getInventory().getItem(0).getCount()==11,"only exact wanted amount debited");
            require(ItemStack.matches(box,buyer.getInventory().getItem(1)),"name, nested inventory, enchantment and damage preserved");
            require(!service.buy(other,listing).success(),"second stale buyer cannot buy retired listing");
            require(other.getInventory().getItem(0).getCount()==16,"losing buyer keeps payment");
            require(service.pending(seller.getUUID()).getFirst().getCount()==5,"offline seller receives durable proceeds");
            service=new MarketService(server); require(service.find(listing)==null && service.pending(seller.getUUID()).getFirst().getCount()==5,"restart preserves purchase and seller proceeds");
            for(int slot=0;slot<36;slot++) seller.getInventory().setItem(slot,new ItemStack(Items.STONE,64));
            require(!service.claim(seller).success(),"full inventory preserves entire claim");
            seller.getInventory().setItem(0,currency.copyWithCount(62));
            require(service.claim(seller).success(),"partial claim inserts only fitting amount");
            require(seller.getInventory().getItem(0).getCount()==64 && service.pending(seller.getUUID()).getFirst().getCount()==3,"partial remainder saved exactly");
            service=new MarketService(server); seller.getInventory().setItem(1,ItemStack.EMPTY);
            require(service.claim(seller).success(),"partial claim survives restart");
            require(ItemStack.matches(currency.copyWithCount(3),seller.getInventory().getItem(1)),"seller payment retains exact metadata");
            reset(service,seller); require(!service.claim(seller).success(),"claim cannot replay");
            seller.getInventory().setItem(2,new ItemStack(Items.EMERALD,6));
            require(service.post(seller,new MarketService.Draft(2,seller.getInventory().getItem(2),4,currency,1)).success(),"refund fixture posted");
            UUID cancelled=service.listings().getFirst().id(); reset(service,seller);
            require(service.cancel(seller,cancelled).success(),"owner cancellation moves escrow into refund"); reset(service,seller);
            require(!service.cancel(seller,cancelled).success(),"cancel replay inert");
            require(service.claim(seller).success(),"cancel refund claim");
            require(seller.getInventory().getItem(2).getCount()==6,"exact offer refunded once");
            service=new MarketService(server); PickerSelfTest.run(server,service); menuTests(server,service);
            journalTests(server,other);
            transactionFailureTests(server);
            AuctionSelfTest.run(server);
            ServerMarket.LOGGER.info("SERVER_MARKET_NATIVE_TEST_PASS");
        } catch(Throwable failure) { ServerMarket.LOGGER.error("SERVER_MARKET_NATIVE_TEST_FAIL",failure); }
    }
    private static void menuTests(MinecraftServer server,MarketService service) {
        ServerPlayer seller=player(server,"MarketMenu"),buyer=player(server,"MarketMenuBuy");
        ItemStack offer=new ItemStack(Items.EMERALD,8),wanted=new ItemStack(Items.GOLD_INGOT,12);
        seller.getInventory().setItem(9,offer.copy()); seller.getInventory().setItem(0,wanted.copy()); buyer.getInventory().setItem(0,wanted.copy());
        List<ItemStack> original=MarketService.inventory(seller);
        for(ContainerInput input:ContainerInput.values()) {
            MarketMenus.Menu menu=menu(seller,service,MarketMenus.Page.OFFER,null,null);
            for(int slot:new int[]{0,20,53,54,89,-999}) {
                menu.clicked(slot,0,input,seller);
                require(ItemStack.listMatches(original,MarketService.inventory(seller)),"mirror click cannot transfer "+input+" / "+slot);
                require(menu.getCarried().isEmpty(),"no display item enters cursor");
            }
            require(menu.quickMoveStack(seller,0).isEmpty(),"direct shift transfer denied");
            require(menu.slots.stream().noneMatch(v->v.mayPickup(seller) || v.mayPlace(offer)),"all physical slots locked");
        }
        MarketService.Draft draft=new MarketService.Draft(9,offer,3,wanted,5);
        MarketMenus.Menu stale=menu(seller,service,MarketMenus.Page.CREATE,draft,null);
        seller.getInventory().getItem(9).shrink(1); stale.clicked(53,0,ContainerInput.PICKUP,seller);
        require(service.listings().isEmpty() && seller.getInventory().getItem(9).getCount()==7,"stale draft takes nothing");
        seller.getInventory().setItem(9,offer.copy());
        MarketMenus.Menu closed=menu(seller,service,MarketMenus.Page.CREATE,draft,null); closed.removed(seller); seller.containerMenu=seller.inventoryMenu;
        closed.clicked(53,0,ContainerInput.PICKUP,seller); require(service.listings().isEmpty(),"closed confirmation cannot commit");
        MarketMenus.Menu create=menu(seller,service,MarketMenus.Page.CREATE,draft,null);
        for(ContainerInput input:ContainerInput.values()) if(input!=ContainerInput.PICKUP) create.clicked(53,0,input,seller);
        create.clicked(53,1,ContainerInput.PICKUP,seller); require(service.listings().isEmpty(),"only normal left confirmation allowed");
        create.clicked(53,0,ContainerInput.PICKUP,seller); create.clicked(53,0,ContainerInput.PICKUP,seller);
        require(service.listings().size()==1 && seller.getInventory().getItem(9).getCount()==5,"confirmed draft debited once");
        MarketService.Listing listing=service.listings().getFirst();
        MarketMenus.Menu buy=menu(buyer,service,MarketMenus.Page.BUY,null,listing);
        buy.clicked(53,0,ContainerInput.QUICK_MOVE,buyer); require(buyer.getInventory().getItem(0).getCount()==12,"shift-buy inert");
        buy.clicked(53,0,ContainerInput.PICKUP,buyer); buy.clicked(53,0,ContainerInput.PICKUP,buyer);
        require(service.find(listing.id())==null && buyer.getInventory().getItem(0).getCount()==7,"buy confirmation cannot replay");
        reset(service,seller); seller.containerMenu=seller.inventoryMenu;
        MarketService.Result staged=service.stage(seller,new MarketService.Draft(9,seller.getInventory().getItem(9),1,wanted,2),null,false);
        String token=staged.message().substring(staged.message().lastIndexOf(' ')+1);
        require(!service.confirm(seller,"wrong-token").success(),"wrong confirmation token inert");
        require(service.confirm(seller,token).success(),"command fallback explicit confirmation works");
        require(!service.confirm(seller,token).success(),"command token single-use");
        staged=service.stage(seller,null,service.listings().getFirst().id(),true); token=staged.message().substring(staged.message().lastIndexOf(' ')+1);
        service.onDisconnect(seller); require(!service.confirm(seller,token).success(),"disconnect expires pending command confirmation");
        ServerMarket.LOGGER.info("SERVER_MARKET_MENU_TEST_PASS");
    }
    private static void journalTests(MinecraftServer server,ServerPlayer player) throws Exception {
        Path ledger=server.getWorldPath(LevelResource.ROOT).resolve("server-market/ledger.json");
        MarketStore store=new MarketStore(ledger); JsonObject next=store.state(); JsonArray items=new JsonArray();
        items.add(ItemStack.CODEC.encodeStart(RegistryOps.create(JsonOps.INSTANCE,server.registryAccess()),new ItemStack(Items.APPLE,9)).getOrThrow());
        next.getAsJsonObject("pending").add(player.getUUID().toString(),items);
        String marker=MarketStore.MARKER_PREFIX+UUID.randomUUID(); store.begin(player.getUUID(),marker,next);
        require(new MarketService(server).pending(player.getUUID()).isEmpty(),"crash before native save rolls ledger back");
        store=new MarketStore(ledger); store.begin(player.getUUID(),marker,next); player.addTag(marker);
        ((MinecraftServerAccessor)server).market$playerDataStorage().save(player);
        require(new MarketService(server).pending(player.getUUID()).getFirst().getCount()==9,"native saved marker commits recovery");
        require(new MarketService(server).pending(player.getUUID()).getFirst().getCount()==9,"native recovery idempotent");
    }
    private static void transactionFailureTests(MinecraftServer server) throws Exception {
        Path ledger=server.getWorldPath(LevelResource.ROOT).resolve("server-market/ledger.json");
        for(int test=0;test<5;test++) {
            final int mode=test;
            ServerPlayer player=player(server,"MarketFault"+test);
            ItemStack original=new ItemStack(Items.EMERALD,10); original.set(DataComponents.CUSTOM_NAME,Component.literal("Fault-safe escrow"));
            player.getInventory().setItem(0,original.copy());
            ((MinecraftServerAccessor)server).market$playerDataStorage().save(player);
            JsonObject before=new MarketStore(ledger).state();
            MarketService service=new MarketService(server,new MarketService.Faults() {
                int writes;
                @Override public void beforeNativeSave() throws java.io.IOException {
                    if(mode==0 || mode==3) throw new java.io.IOException("TEST: native player save unavailable");
                }
                @Override public void beforeLedgerReplace() throws java.io.IOException {
                    writes++;
                    if((mode==2 || mode==3) && writes>=2 || mode==4 && writes==2)
                        throw new java.io.IOException("TEST: journal finish unavailable");
                }
                @Override public void beforeMarkerRead() throws java.io.IOException {
                    if(mode==1) throw new java.io.IOException("TEST: player marker unreadable");
                }
            });
            MarketService.Result result=service.post(player,new MarketService.Draft(0,original,4,new ItemStack(Items.DIAMOND),2));
            boolean commit=mode==1 || mode==2 || mode==4;
            require(player.getInventory().getItem(0).getCount()==(commit?6:10),"fault "+mode+": in-memory inventory matches decision");
            MarketStore unresolved=new MarketStore(ledger);
            if(mode==0) {
                require(!result.success() && service.available() && !unresolved.hasTransaction(),"save failure cleanly aborts journal and stays usable");
                require(unresolved.state().equals(before),"failed native save cannot create unpaid escrow");
            } else if(mode==4) {
                require(result.success() && service.available() && !unresolved.hasTransaction(),"one-time commit failure retries durable marker decision");
                require(player.entityTags().stream().noneMatch(v->v.startsWith(MarketStore.MARKER_PREFIX)),"successful retry clears only resolved marker");
            } else {
                require(!result.success() && !service.available() && unresolved.hasTransaction(),"fault "+mode+": undecidable/unfinished journal quarantines service");
                require(unresolved.state().equals(before),"fault "+mode+": committed ledger untouched until recovery");
                require(player.entityTags().stream().anyMatch(v->v.startsWith(MarketStore.MARKER_PREFIX))==commit,"fault "+mode+": marker and inventory remain consistent on disconnect");
            }
            MarketService recovered=new MarketService(server);
            long listings=recovered.listings().stream().filter(v->v.seller().equals(player.getUUID())).count();
            require(listings==(commit?1:0),"fault "+mode+": restart resolves exactly one conserved outcome");
            if(commit) require(recovered.listings().stream().filter(v->v.seller().equals(player.getUUID())).findFirst().orElseThrow().offer().getCount()+player.getInventory().getItem(0).getCount()==10,"fault "+mode+": inventory plus escrow conserved");
            require(!new MarketStore(ledger).hasTransaction(),"fault "+mode+": recovery clears journal once");
        }
        ServerMarket.LOGGER.info("SERVER_MARKET_TRANSACTION_FAILURE_TEST_PASS");
    }
    private static MarketMenus.Menu menu(ServerPlayer player,MarketService service,MarketMenus.Page page,MarketService.Draft draft,MarketService.Listing listing) {
        MarketMenus.Menu menu=new MarketMenus.Menu(17,player,service,page,draft,listing); player.containerMenu=menu; return menu;
    }
    private static void reset(MarketService service,ServerPlayer player) { service.onDisconnect(player); }
    private static ServerPlayer player(MinecraftServer server,String name) {
        GameProfile profile=new GameProfile(UUID.nameUUIDFromBytes(("MarketFixture:"+name).getBytes(java.nio.charset.StandardCharsets.UTF_8)),name);
        ServerPlayer player=new ServerPlayer(server,server.overworld(),profile,ClientInformation.createDefault());
        player.connection=new ServerGamePacketListenerImpl(server,new Connection(PacketFlow.SERVERBOUND),player,CommonListenerCookie.createInitial(profile,false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL); return player;
    }
    private static void require(boolean condition,String message) { if(!condition) throw new IllegalStateException(message); ServerMarket.LOGGER.info("MARKET_TEST: {}",message); }
}
