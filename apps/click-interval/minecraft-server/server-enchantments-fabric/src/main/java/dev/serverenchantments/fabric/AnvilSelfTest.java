package dev.serverenchantments.fabric;

import com.mojang.authlib.GameProfile;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.GameType;
import org.slf4j.LoggerFactory;
import java.util.UUID;

/** Real transformed menu/click path; called only by the disposable-world selftest. */
final class AnvilSelfTest {
    private AnvilSelfTest() { }
    static void run(MinecraftServer server) {
        GameProfile profile=new GameProfile(UUID.fromString("4b53ed8e-c963-4936-b0c3-86db6b02729f"),"AnvilSelfTest");
        ServerPlayer player=new ServerPlayer(server,server.overworld(),profile,ClientInformation.createDefault());
        player.connection=new ServerGamePacketListenerImpl(server,new Connection(PacketFlow.SERVERBOUND),player,CommonListenerCookie.createInitial(profile,false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        var registry=server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT);
        Holder<Enchantment> unbreaking=registry.getOrThrow(Enchantments.UNBREAKING);
        try {
            AnvilMenu menu=menu(player,tool(127,500),new ItemStack(Items.DIAMOND,4));
            require(menu.getCost()==39 && !menu.getSlot(2).getItem().isEmpty(),"expensive repair capped with output");
            require(menu.getSlot(2).getItem().getDamageValue()==0,"native repair amount");
            require(menu.getSlot(2).getItem().getOrDefault(DataComponents.REPAIR_COST,0)==255,"native prior-work growth");
            player.experienceLevel=38;
            require(!menu.getSlot(2).mayPickup(player),"insufficient XP rejected");
            take(menu,player);
            require(menu.getCarried().isEmpty() && player.experienceLevel==38,"failed pickup gives no free output");
            require(menu.getSlot(0).getItem().getDamageValue()==500 && menu.getSlot(1).getItem().getCount()==4,"failed pickup preserves inputs");
            player.experienceLevel=39;
            take(menu,player);
            require(player.experienceLevel==0 && menu.getCarried().is(Items.DIAMOND_PICKAXE),"native pickup pays39");
            require(menu.getSlot(0).getItem().isEmpty() && menu.getSlot(1).getItem().getCount()==2,"exact native material consumption");
            require(menu.getSlot(2).getItem().isEmpty() && menu.getCost()==0,"no duplicate result");
            require(!player.hasInfiniteMaterials(),"survival never granted creative");
            clear(menu);

            menu=menu(player,tool(39,100),new ItemStack(Items.DIAMOND));
            require(menu.getCost()==39 && !menu.getSlot(2).getItem().isEmpty(),"exactly40 becomes39");
            clear(menu);
            menu=menu(player,tool(0,100),new ItemStack(Items.DIAMOND));
            require(menu.getCost()==1,"cheap repair unchanged");
            clear(menu);

            menu=menu(player,tool(127,100),book(unbreaking,1));
            require(menu.getCost()==39,"expensive combination capped");
            require(EnchantmentHelper.getItemEnchantmentLevel(unbreaking,menu.getSlot(2).getItem())==1,"native enchanted output");
            player.experienceLevel=50;
            take(menu,player);
            require(player.experienceLevel==11 && menu.getSlot(1).getItem().isEmpty(),"combine pays39 and consumes book");
            clear(menu);

            menu=menu(player,new ItemStack(Items.DIAMOND_PICKAXE),ItemStack.EMPTY);
            require(menu.getSlot(2).getItem().isEmpty() && menu.getCost()==0,"no-op has no output");
            require(menu.setItemName("Anvil Test") && menu.getCost()==1,"cheap rename remains1");
            player.experienceLevel=1;
            take(menu,player);
            require(player.experienceLevel==0 && "Anvil Test".equals(menu.getCarried().getHoverName().getString()),"rename native payment");
            clear(menu);

            ItemStack silk=tool(127,0);
            silk.enchant(registry.getOrThrow(Enchantments.SILK_TOUCH),1);
            menu=menu(player,silk,book(registry.getOrThrow(Enchantments.FORTUNE),3));
            require(menu.getSlot(2).getItem().isEmpty() && menu.getCost()==0,"incompatible enchantments rejected");
            clear(menu);
            menu=menu(player,tool(127,100),new ItemStack(Items.DIRT));
            require(menu.getSlot(2).getItem().isEmpty(),"invalid repair material rejected");
            clear(menu);

            menu=menu(player,book(unbreaking,1),book(unbreaking,1));
            menu.getSlot(0).getItem().setCount(2); // Explicit malformed stack guarded natively by cost40.
            menu.createResult();
            require(menu.getCost()>=40 && menu.getSlot(2).getItem().isEmpty(),"stacked enchantment sentinel not bypassed");
            clear(menu);

            player.gameMode.changeGameModeForPlayer(GameType.CREATIVE);
            player.experienceLevel=0;
            menu=menu(player,tool(127,100),new ItemStack(Items.DIAMOND));
            require(menu.getCost()==128 && !menu.getSlot(2).getItem().isEmpty(),"creative cost remains vanilla");
            take(menu,player);
            require(player.experienceLevel==0 && !menu.getCarried().isEmpty(),"native creative exception unchanged");
            clear(menu);
            player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
            menu=menu(player,tool(127,100),new ItemStack(Items.DIAMOND));
            require(!menu.getSlot(2).mayPickup(player),"return to survival requires XP");
            clear(menu);
            LoggerFactory.getLogger("serverenchantments_fabric").info("SERVER_ANVIL_CAP_SELFTEST_PASS: native expensive repairs/combines, exactly40, cheap rename, insufficientXP, exact XP/material payment, no duplicate output, incompatibility, stacked-input rejection, creative/survival permissions.");
        } finally {
            if(player.containerMenu instanceof AnvilMenu menu) clear(menu);
            player.containerMenu=player.inventoryMenu;
            player.discard();
        }
    }
    private static AnvilMenu menu(ServerPlayer player,ItemStack first,ItemStack second) {
        AnvilMenu menu=new AnvilMenu(77,player.getInventory());
        player.containerMenu=menu;
        menu.getSlot(0).set(first);menu.getSlot(1).set(second);menu.createResult();
        return menu;
    }
    private static ItemStack tool(int priorWork,int damage) {
        ItemStack stack=new ItemStack(Items.DIAMOND_PICKAXE);
        stack.setDamageValue(damage);stack.set(DataComponents.REPAIR_COST,priorWork);return stack;
    }
    private static ItemStack book(Holder<Enchantment> enchantment,int level) {
        ItemStack stack=new ItemStack(Items.ENCHANTED_BOOK);stack.enchant(enchantment,level);return stack;
    }
    private static void take(AnvilMenu menu,ServerPlayer player) { menu.clicked(2,0,ContainerInput.PICKUP,player); }
    private static void clear(AnvilMenu menu) {
        menu.setCarried(ItemStack.EMPTY);menu.getSlot(0).set(ItemStack.EMPTY);menu.getSlot(1).set(ItemStack.EMPTY);menu.createResult();
    }
    private static void require(boolean passed,String message) { if(!passed)throw new IllegalStateException("Anvil self-test: "+message); }
}
