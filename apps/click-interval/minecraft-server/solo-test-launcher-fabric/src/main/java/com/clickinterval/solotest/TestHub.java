package com.clickinterval.solotest;

import java.nio.file.*;
import java.util.UUID;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.*;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.world.item.*;
import net.minecraft.world.level.storage.LevelResource;

/** Commands are registered only by the client entrypoint, in integrated command trees. */
final class TestHub {
    static boolean allowed(boolean integrated,boolean actualClientServer,boolean host,boolean cheats,boolean exactWorld) {
        return integrated && actualClientServer && host && cheats && exactWorld;
    }
    static boolean permitted(CommandSourceStack source) {
        try {
            var server=source.getServer(); ServerPlayer player=source.getPlayer();
            if(player==null || server.getSingleplayerProfile()==null) return false;
            Path world=server.getWorldPath(LevelResource.ROOT); RequestProtocol.plain(world,true);
            new RequestProtocol(Minecraft.getInstance().gameDirectory.toPath(),RequestProtocol.EXPECTED_GAME).validateTestHubWorld(world);
            return allowed(server.isSingleplayer(),server==Minecraft.getInstance().getSingleplayerServer(),
                player.getUUID().equals(server.getSingleplayerProfile().id()),source.permissions().hasPermission(Permissions.COMMANDS_GAMEMASTER),
                true);
        } catch(Exception refused) { return false; }
    }
    static void register() {
        CommandRegistrationCallback.EVENT.register((dispatcher,registry,environment)-> {
            if(environment!=Commands.CommandSelection.INTEGRATED) return;
            dispatcher.register(Commands.literal("testhub").requires(TestHub::permitted)
                .executes(context->{ context.getSource().sendSuccess(()->Component.literal("Test worlds only: /testhub settings for dimension locks; /testhub kit for supplies; /testhub demos for merchant offers; /market and /ah to test."),false); return 1; })
                .then(Commands.literal("kit").executes(context->kit(context.getSource())))
                .then(Commands.literal("settings").executes(context->settings(context.getSource())))
                .then(Commands.literal("demos").executes(context->demos(context.getSource()))));
        });
    }
    private static int settings(CommandSourceStack source) {
        if(!permitted(source)) return 0;
        var server=source.getServer(); UUID host=source.getPlayer().getUUID();
        Minecraft client=Minecraft.getInstance();
        client.execute(()-> {
            if(client.getSingleplayerServer()!=server || client.level==null || client.player==null || !host.equals(client.player.getUUID())) return;
            client.gui.setScreen(new TestSettingsScreen(server,host));
        });
        return 1;
    }
    private static int kit(CommandSourceStack source) {
        if(!permitted(source)) return 0;
        ServerPlayer player=source.getPlayer(); int inserted=0;
        for(ItemStack wanted:new ItemStack[]{new ItemStack(Items.DIAMOND,32),new ItemStack(Items.IRON_INGOT,32)}) {
            int before=wanted.getCount(); player.getInventory().add(wanted); inserted+=before-wanted.getCount();
            // Inventory.add leaves overflow in this local stack. Never drop it or overwrite a slot.
        }
        player.inventoryMenu.broadcastChanges();
        int count=inserted; source.sendSuccess(()->Component.literal("Test supplies added: "+count+" items. No inventory slots cleared and no overflow dropped."),false); return 1;
    }
    private static int demos(CommandSourceStack source) {
        if(!permitted(source)) return 0;
        if(!FabricLoader.getInstance().isModLoaded("servermarket_fabric")) { source.sendFailure(Component.literal("Server Market is not installed.")); return 0; }
        try { return TestMerchant.create(source); }
        catch(Exception failure) { source.sendFailure(Component.literal("Demo setup stopped safely: "+failure.getClass().getSimpleName()+". Existing escrow preserved.")); return 0; }
    }
}
