package com.clickinterval.market;

import com.mojang.authlib.GameProfile;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.*;
import net.minecraft.world.level.GameType;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Invoked only behind MarketSelfTest's opt-in AND fresh fixture-world guard. */
final class PickerSelfTest {
    private static int checks;
    static void run(MinecraftServer server,MarketService service) {
        checks=0;
        ServerPlayer seller=player(server,"PickerSeller"),stranger=player(server,"PickerStranger");
        ItemStack offer=new ItemStack(Items.EMERALD,8);
        ItemStack special=new ItemStack(Items.DIAMOND_SWORD); special.setDamageValue(117);
        special.set(DataComponents.CUSTOM_NAME,Component.literal("Exact wanted sword"));
        seller.getInventory().setItem(0,offer.copy()); seller.getInventory().setItem(9,special.copy());
        MarketService.Draft draft=new MarketService.Draft(0,offer,1,new ItemStack(Items.DIAMOND),1);
        List<ItemStack> inventory=MarketService.inventory(seller);
        var catalog=WantedItemCatalog.get(server);
        require(catalog==WantedItemCatalog.get(server),"catalog is reused on repeated opens");
        var all=catalog.categories().getFirst(); Set<Item> covered=Collections.newSetFromMap(new IdentityHashMap<>());
        for(int index=0;index<all.size();index++) {
            ItemStack stack=all.item(index); covered.add(stack.getItem());
            require(WantedItemCatalog.allowed(stack,server.getWorldData().enabledFeatures()),"catalog entry obeys eligibility");
        }
        for(Item item:BuiltInRegistries.ITEM) if(WantedItemCatalog.allowed(item.getDefaultInstance(),server.getWorldData().enabledFeatures()))
            require(covered.contains(item),"eligible registry item covered: "+BuiltInRegistries.ITEM.getKey(item));
        require(covered.contains(Items.DIAMOND) && !covered.contains(Items.BARRIER) && !covered.contains(Items.AIR),"all-items includes unowned normal items but no admin placeholders");
        ItemStack copy=all.item(0); ItemStack original=copy.copy(); copy.set(DataComponents.CUSTOM_NAME,Component.literal("Tamper"));
        require(ItemStack.matches(original,all.item(0)),"catalog samples are defensive copies");
        all.icon().setCount(13); require(all.icon().getCount()==1,"category icons are defensive copies");
        require(catalog.categories().size()>5,"creative categories are populated server-side");

        AtomicReference<ItemStack> chosen=new AtomicReference<>(); AtomicInteger backs=new AtomicInteger();
        // Test every native click mode at every relevant boundary, with every mouse /
        // hotbar button, using actual ChestMenu slots. No inventory or cursor change.
        for(ContainerInput input:ContainerInput.values()) for(int button=-1;button<=9;button++) {
            WantedItemPicker.open(seller,draft,chosen::set,backs::incrementAndGet);
            var menu=picker(seller);
            for(int slot:new int[]{-999,-1,0,2,4,8,9,10,22,44,45,47,49,51,53,54,89}) {
                menu.clicked(slot,button,input,seller);
                require(ItemStack.listMatches(inventory,MarketService.inventory(seller)) && menu.getCarried().isEmpty(),"picker icons cannot transfer through native input");
            }
            require(menu.quickMoveStack(seller,9).isEmpty() && menu.slots.stream().noneMatch(v->v.mayPickup(seller) || v.mayPlace(offer)),"picker locks all transfer slots");
            require(!menu.canDragTo(menu.slots.get(9)) && !menu.canTakeItemForPickAll(offer,menu.slots.get(9)) && !menu.clickMenuButton(seller,0),"picker denies alternate transfer APIs");
        }
        require(chosen.get()==null,"category icons never select a wanted stack");
        WantedItemPicker.open(seller,draft,chosen::set,backs::incrementAndGet);
        var categories=picker(seller);
        require(categories.getContainer().getItem(4).is(Items.PAPER)
                && categories.getContainer().getItem(4).getHoverName().getString().equals("Choose what you want for this item"),"paper instruction uses requested wording");
        require(categories.getContainer().getItem(2).is(Items.EMERALD),"selected offered item stays visible above categories");
        categories.clicked(10,0,ContainerInput.PICKUP,stranger); require(seller.containerMenu==categories,"wrong player cannot navigate picker");
        categories.clicked(10,0,ContainerInput.PICKUP,seller); var first=picker(seller);
        require(first!=categories && first.getContainer().getItem(51).is(Items.ARROW),"all-items category has pages in a fresh native menu");
        categories.clicked(9,0,ContainerInput.PICKUP,seller); require(seller.containerMenu==first,"replayed category click cannot reopen old category");
        first.clicked(51,0,ContainerInput.PICKUP,seller); var second=picker(seller);
        require(second!=first && second.getContainer().getItem(47).is(Items.ARROW),"next page replaces container and exposes previous");
        first.clicked(9,0,ContainerInput.PICKUP,seller); require(chosen.get()==null && seller.containerMenu==second,"old-page clicks cannot choose a different item");
        second.clicked(47,0,ContainerInput.PICKUP,seller); var previous=picker(seller);
        require(previous.getContainer().getItem(9).is(first.getContainer().getItem(9).getItem()),"previous page returns to same item order");
        previous.clicked(45,0,ContainerInput.PICKUP,seller); require(picker(seller).getContainer().getItem(9).getHoverName().getString().equals("Your inventory"),"back from items returns to categories");

        // Exact inventory samples retain original components, not GUI-only lore.
        var owned=picker(seller); owned.clicked(9,0,ContainerInput.PICKUP,seller); owned=picker(seller);
        int specialSlot=findOnPage(owned,Items.DIAMOND_SWORD); require(specialSlot>=0,"exact inventory sample category is available");
        owned.clicked(specialSlot,0,ContainerInput.PICKUP,seller);
        require(ItemStack.isSameItemSameComponents(special,chosen.get()),"wanted selection preserves damage/name and does not leak display lore");
        chosen.set(null); owned.clicked(specialSlot,0,ContainerInput.PICKUP,seller); require(chosen.get()==null,"wanted selection callback runs once");
        WantedItemPicker.open(seller,draft,chosen::set,backs::incrementAndGet); picker(seller).clicked(9,0,ContainerInput.PICKUP,seller);
        owned=picker(seller); seller.getInventory().setItem(9,new ItemStack(Items.DIAMOND_SWORD));
        owned.clicked(findOnPage(owned,Items.DIAMOND_SWORD),0,ContainerInput.PICKUP,seller); require(chosen.get()==null,"changed exact inventory sample is rejected");
        seller.getInventory().setItem(9,special.copy());
        WantedItemPicker.open(seller,draft,chosen::set,backs::incrementAndGet); picker(seller).clicked(10,0,ContainerInput.PICKUP,seller);
        var stale=picker(seller); seller.getInventory().getItem(0).shrink(1); stale.clicked(9,0,ContainerInput.PICKUP,seller);
        require(chosen.get()==null && seller.getInventory().getItem(0).getCount()==7,"changed offer rejects picker selection without debit");
        seller.getInventory().setItem(0,offer.copy());
        WantedItemPicker.open(seller,draft,chosen::set,backs::incrementAndGet); var closed=picker(seller);
        closed.removed(seller); seller.containerMenu=seller.inventoryMenu; closed.clicked(10,0,ContainerInput.PICKUP,seller);
        require(seller.containerMenu==seller.inventoryMenu && chosen.get()==null,"closed picker cannot replay");

        // Exercise both public create workflows, including a payment item absent
        // from the seller inventory, quantity adjustment, back and final escrow.
        MarketMenus.create(seller,service); seller.containerMenu.clicked(27,0,ContainerInput.PICKUP,seller);
        chooseUnowned(seller,Items.DIAMOND);
        require(seller.containerMenu instanceof MarketMenus.Menu && seller.containerMenu.getSlot(24).getItem().is(Items.DIAMOND),"market reaches amount confirmation for unowned diamond");
        var confirm=seller.containerMenu; confirm.clicked(25,0,ContainerInput.PICKUP,seller);
        require(ItemStack.listMatches(inventory,MarketService.inventory(seller)),"selection and amounts never mutate inventory");
        confirm.clicked(45,0,ContainerInput.PICKUP,seller); require(seller.containerMenu instanceof WantedItemPicker.Menu,"market confirmation back returns to wanted categories");
        chooseUnowned(seller,Items.DIAMOND); confirm=seller.containerMenu;
        confirm.clicked(53,0,ContainerInput.PICKUP,seller); confirm.clicked(53,0,ContainerInput.PICKUP,seller);
        var listing=service.listings().stream().filter(v->v.seller().equals(seller.getUUID())).findFirst().orElseThrow();
        require(listing.want().is(Items.DIAMOND) && seller.getInventory().getItem(0).getCount()==7,"unowned wanted item commits exactly one escrow debit");
        service.onDisconnect(seller); require(service.cancel(seller,listing.id()).success(),"picker-created listing cancels safely");
        service.onDisconnect(seller); require(service.claim(seller).success(),"picker-created escrow refund is claimable");
        require(ItemStack.listMatches(inventory,MarketService.inventory(seller)),"market picker transaction conserves complete inventory");
        AuctionMenus.create(seller,service); seller.containerMenu.clicked(27,0,ContainerInput.PICKUP,seller);
        chooseUnowned(seller,Items.GOLD_INGOT);
        require(seller.containerMenu instanceof AuctionMenus.Menu && seller.containerMenu.getSlot(24).getItem().is(Items.GOLD_INGOT),"auction shares catalog and reaches minimum/duration confirmation");
        seller.containerMenu.clicked(45,0,ContainerInput.PICKUP,seller); require(seller.containerMenu instanceof WantedItemPicker.Menu,"auction back returns to wanted categories");
        seller.closeContainer(); require(ItemStack.listMatches(inventory,MarketService.inventory(seller)),"closing auction picker never takes items");
        ServerMarket.LOGGER.info("SERVER_MARKET_PICKER_NATIVE_TEST_PASS checks={}",checks);
    }
    private static void chooseUnowned(ServerPlayer player,Item item) {
        picker(player).clicked(10,0,ContainerInput.PICKUP,player); // All items (Your inventory is first).
        for(int page=0;page<200;page++) {
            var menu=picker(player); int slot=findOnPage(menu,item);
            if(slot>=0) { menu.clicked(slot,0,ContainerInput.PICKUP,player); return; }
            if(!menu.getContainer().getItem(51).is(Items.ARROW)) break;
            menu.clicked(51,0,ContainerInput.PICKUP,player);
        }
        throw new IllegalStateException("Wanted item not found: "+item);
    }
    private static int findOnPage(WantedItemPicker.Menu menu,Item item) {
        for(int slot=9;slot<45;slot++) if(menu.getContainer().getItem(slot).is(item)) return slot; return -1;
    }
    private static WantedItemPicker.Menu picker(ServerPlayer player) { return (WantedItemPicker.Menu)player.containerMenu; }
    private static ServerPlayer player(MinecraftServer server,String name) {
        GameProfile profile=new GameProfile(UUID.nameUUIDFromBytes(("PickerFixture:"+name).getBytes(java.nio.charset.StandardCharsets.UTF_8)),name);
        ServerPlayer player=new ServerPlayer(server,server.overworld(),profile,ClientInformation.createDefault());
        player.connection=new ServerGamePacketListenerImpl(server,new Connection(PacketFlow.SERVERBOUND),player,CommonListenerCookie.createInitial(profile,false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL); return player;
    }
    private static void require(boolean condition,String description) {
        if(!condition) throw new IllegalStateException("PICKER TEST: "+description); checks++;
    }
}
