package com.clickinterval.bounties;

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

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Explicitly opt-in, disposable-world integration checks; never runs normally. */
final class BountyMenuSelfTest {
    static void run(MinecraftServer server, BountyService service) {
        ServerPlayer player = player(server, "MenuSponsor");
        service.onJoin(player);
        for (int i = 0; i < 50; i++) service.onJoin(player(server, "MenuTarget" + String.format("%02d", i)));
        BountyService.Target target = service.targets(player).stream().filter(t -> t.name().equals("MenuTarget00")).findFirst().orElseThrow();
        ItemStack diamonds = new ItemStack(Items.DIAMOND, 64);
        diamonds.set(DataComponents.CUSTOM_NAME, Component.literal("Exact escrow diamonds"));
        player.getInventory().setItem(9, diamonds.copy());
        player.getInventory().setItem(0, new ItemStack(Items.GOLD_INGOT, 12));
        List<ItemStack> original = inventory(player);

        BountyMenus.Menu heads = menu(player, service, BountyMenus.Page.TARGETS, target);
        require(heads.getContainer().getItem(51).is(Items.ARROW), "target list has next-page arrow for >45 players");
        ItemStack first = heads.getContainer().getItem(0).copy();
        click(heads, player, 51, 0, ContainerInput.PICKUP);
        require(!ItemStack.matches(first, heads.getContainer().getItem(0)), "next-page heads differ");
        require(heads.getContainer().getItem(47).is(Items.ARROW), "previous page exists");
        click(heads, player, 47, 0, ContainerInput.PICKUP);
        require(ItemStack.matches(first, heads.getContainer().getItem(0)), "previous page restores first head");
        require(ItemStack.listMatches(original, inventory(player)), "head selection/page navigation never takes payment");

        for (ContainerInput input : ContainerInput.values()) {
            BountyMenus.Menu locked = menu(player, service, BountyMenus.Page.REWARDS, target);
            for (int slot : new int[]{0, 27, 40, 54, 89, -999}) {
                click(locked, player, slot, 0, input);
                require(ItemStack.listMatches(original, inventory(player)), "no transfer via " + input + " slot " + slot);
                require(locked.getCarried().isEmpty(), "display never enters cursor via " + input);
            }
            require(locked.quickMoveStack(player, 0).isEmpty(), "direct quick move denied");
            require(locked.slots.stream().noneMatch(s -> s.mayPickup(player) || s.mayPlace(new ItemStack(Items.STONE))), "all slots reject native item transfers");
        }

        BountyMenus.Menu empty = menu(player, service, BountyMenus.Page.REWARDS, target);
        click(empty, player, 53, 0, ContainerInput.PICKUP);
        require(ItemStack.listMatches(original, inventory(player)), "empty confirm charges nothing");
        BountyMenus.Menu stale = menu(player, service, BountyMenus.Page.REWARDS, target);
        click(stale, player, 0, 0, ContainerInput.QUICK_MOVE);
        player.getInventory().getItem(9).shrink(1);
        click(stale, player, 53, 0, ContainerInput.PICKUP);
        require(player.getInventory().getItem(9).getCount() == 63, "stale-count submit not charged");
        player.getInventory().setItem(9, diamonds.copy());

        BountyMenus.Menu staleComponents = menu(player, service, BountyMenus.Page.REWARDS, target);
        click(staleComponents, player, 0, 0, ContainerInput.PICKUP);
        player.getInventory().getItem(9).set(DataComponents.CUSTOM_NAME, Component.literal("Changed name"));
        click(staleComponents, player, 53, 0, ContainerInput.PICKUP);
        require(player.getInventory().getItem(9).getCount() == 64, "stale-components submit not charged");
        player.getInventory().setItem(9, diamonds.copy());

        BountyMenus.Menu cancel = menu(player, service, BountyMenus.Page.REWARDS, target);
        click(cancel, player, 0, 0, ContainerInput.QUICK_MOVE);
        cancel.removed(player);
        player.containerMenu = player.inventoryMenu;
        require(ItemStack.listMatches(original, inventory(player)), "closing draft preserves all items");
        click(cancel, player, 53, 0, ContainerInput.PICKUP);
        require(ItemStack.listMatches(original, inventory(player)), "stale closed menu cannot submit");

        BountyMenus.Menu submit = menu(player, service, BountyMenus.Page.REWARDS, target);
        click(submit, player, 0, 0, ContainerInput.PICKUP); // 1
        click(submit, player, 0, 0, ContainerInput.PICKUP); // 2
        click(submit, player, 0, 1, ContainerInput.PICKUP); // 1
        click(submit, player, 27, 0, ContainerInput.QUICK_MOVE); // whole hotbar stack
        click(submit, player, 27, 1, ContainerInput.QUICK_MOVE); // clear hotbar selection
        click(submit, player, 53, 0, ContainerInput.PICKUP);
        require(player.getInventory().getItem(9).getCount() == 63, "green confirmation takes exact one diamond");
        require(player.getInventory().getItem(0).getCount() == 12, "cleared gold remains untouched");
        require(service.activeBounties().stream().filter(b -> b.targetId().equals(target.id()))
                .flatMap(b -> b.rewards().stream()).anyMatch(s -> s.getCount() == 1 && ItemStack.isSameItemSameComponents(s, diamonds)), "exact item components escrowed");
        click(submit, player, 53, 0, ContainerInput.PICKUP);
        require(player.getInventory().getItem(9).getCount() == 63, "duplicate confirmation does not charge again");
        require(player.containerMenu instanceof BountyMenus.Menu, "successful post returns to bounty board");
        BountyMenus.Menu board = (BountyMenus.Menu) player.containerMenu;
        require(board.getItems().stream().anyMatch(s -> s.is(Items.PLAYER_HEAD) && s.has(DataComponents.LORE)), "board shows reward tooltip on player head");
        require(board.getContainer().getItem(46).is(Items.BOOK), "board exposes My bounties");
        service.onDisconnect(player);
        require(service.post(player,target,List.of(new BountyService.Selection(9,player.getInventory().getItem(9),2))).success(),
                "repeat funding is accepted as an addition to own target bounty");
        click(board, player, 46, 0, ContainerInput.PICKUP);
        BountyMenus.Menu mine = (BountyMenus.Menu) player.containerMenu;
        require(mine.getContainer().getItem(0).is(Items.PLAYER_HEAD) && mine.getContainer().getItem(1).isEmpty(), "repeat contributions display exactly one head");
        require(service.ownedBounties(player.getUUID()).size() == 2 && service.ownedBountyGroups(player.getUUID()).size() == 1, "own grouped view excludes other sponsors");
        click(mine, player, 0, 0, ContainerInput.PICKUP);
        BountyMenus.Menu confirmation = (BountyMenus.Menu) player.containerMenu;
        require(player.getInventory().getItem(9).getCount() == 61, "opening grouped cancellation confirmation refunds nothing");
        require(ItemStack.isSameItemSameComponents(confirmation.getContainer().getItem(0), diamonds)
                && confirmation.getContainer().getItem(0).getCount()==3, "cancellation shows summed reward with exact original components");
        click(confirmation, player, 45, 0, ContainerInput.PICKUP);
        require(service.ownedBounties(player.getUUID()).size() == 2 && player.getInventory().getItem(9).getCount() == 61,
                "back from cancellation keeps bounty and inventory unchanged");
        mine = (BountyMenus.Menu) player.containerMenu;
        click(mine, player, 0, 0, ContainerInput.PICKUP);
        confirmation = (BountyMenus.Menu) player.containerMenu;
        for (ContainerInput input : ContainerInput.values()) if (input != ContainerInput.PICKUP) {
            click(confirmation, player, 53, 0, input);
            require(service.ownedBounties(player.getUUID()).size() == 2, "only ordinary confirmation click can cancel: " + input);
        }
        click(confirmation, player, 53, 1, ContainerInput.PICKUP);
        require(service.ownedBounties(player.getUUID()).size() == 2, "right click cannot cancel");
        click(confirmation, player, 53, 0, ContainerInput.PICKUP);
        require(service.ownedBounties(player.getUUID()).isEmpty(), "green confirmation removes all of own grouped contributions");
        require(player.getInventory().getItem(9).getCount() == 64, "green confirmation refunds original exact count once");
        click(confirmation, player, 53, 0, ContainerInput.PICKUP);
        require(player.getInventory().getItem(9).getCount() == 64, "stale confirmation cannot duplicate refund");
        BountyMenus.Menu forged = new BountyMenus.Menu(13, player, service, BountyMenus.Page.CANCEL, 0, null, target.id());
        player.containerMenu = forged;
        click(forged, player, 53, 0, ContainerInput.PICKUP);
        require(player.getInventory().getItem(9).getCount() == 64, "new forged screen with retired ID cannot refund again");
        service.onDisconnect(player);
        require(service.post(player,target,List.of(new BountyService.Selection(9,player.getInventory().getItem(9),2))).success(), "fund stale grouped-menu fixture");
        mine=menu(player,service,BountyMenus.Page.MINE,null);
        click(mine,player,0,0,ContainerInput.PICKUP);
        BountyMenus.Menu oldGroup=(BountyMenus.Menu)player.containerMenu;
        require(oldGroup.getContainer().getItem(0).getCount()==2,"old confirmation snapshots exact current combined reward");
        service.onDisconnect(player);
        require(service.post(player,target,List.of(new BountyService.Selection(9,player.getInventory().getItem(9),3))).success(), "add newer contribution while old confirmation is open");
        click(oldGroup,player,53,0,ContainerInput.PICKUP);
        require(player.getInventory().getItem(9).getCount()==59 && service.ownedBounties(player.getUUID()).size()==2,
                "old group confirmation refuses to consume unseen newly funded reward");
        mine=(BountyMenus.Menu)player.containerMenu;
        require(mine.getContainer().getItem(0).is(Items.PLAYER_HEAD) && mine.getContainer().getItem(1).isEmpty(),"refreshed own list still has one grouped head");
        click(mine,player,0,0,ContainerInput.PICKUP);
        BountyMenus.Menu newGroup=(BountyMenus.Menu)player.containerMenu;
        require(newGroup.getContainer().getItem(0).getCount()==5,"fresh confirmation includes both rewards");
        click(newGroup,player,53,0,ContainerInput.PICKUP);
        click(oldGroup,player,53,0,ContainerInput.PICKUP);
        click(newGroup,player,53,0,ContainerInput.PICKUP);
        require(player.getInventory().getItem(9).getCount()==64 && service.ownedBounties(player.getUUID()).isEmpty(),
                "fresh grouped confirmation refunds all once and repeated old/new clicks are inert");
        board.removed(player);
        player.containerMenu = player.inventoryMenu;
        ServerBounties.LOGGER.info("SERVER_BOUNTIES_MENU_TEST_PASS: pagination, mirror controls, all click types, grouped owner rows/refunds, stale group preview, stale inventory, exact confirmation and duplicate safety");
    }

    private static BountyMenus.Menu menu(ServerPlayer player, BountyService service, BountyMenus.Page page, BountyService.Target target) {
        BountyMenus.Menu menu = new BountyMenus.Menu(12, player, service, page, 0, target, null);
        player.containerMenu = menu;
        return menu;
    }
    private static void click(BountyMenus.Menu menu, ServerPlayer player, int slot, int button, ContainerInput input) {
        menu.clicked(slot, button, input, player);
    }
    private static List<ItemStack> inventory(ServerPlayer player) {
        List<ItemStack> copy = new ArrayList<>();
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) copy.add(player.getInventory().getItem(i).copy());
        return copy;
    }
    private static ServerPlayer player(MinecraftServer server, String name) {
        GameProfile profile = new GameProfile(UUID.nameUUIDFromBytes(("BountyMenuSelfTest:" + name).getBytes(StandardCharsets.UTF_8)), name);
        ServerPlayer player = new ServerPlayer(server, server.overworld(), profile, ClientInformation.createDefault());
        player.connection = new ServerGamePacketListenerImpl(server, new Connection(PacketFlow.SERVERBOUND), player,
                CommonListenerCookie.createInitial(profile, false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        return player;
    }
    private static void require(boolean success, String test) {
        if (!success) throw new IllegalStateException("SERVER_BOUNTIES_MENU_TEST_FAIL: " + test);
    }
}
