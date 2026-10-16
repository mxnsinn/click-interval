package com.clickinterval.market;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.minecraft.commands.*;
import net.minecraft.commands.arguments.item.ItemArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import java.util.UUID;

public final class MarketCommands {
    private MarketCommands() {}
    @FunctionalInterface private interface Action { MarketService.Result run(ServerPlayer player,MarketService service) throws CommandSyntaxException; }
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher,CommandBuildContext registry) {
        dispatcher.register(Commands.literal("market")
            .executes(ctx->open(ctx.getSource(),0))
            .then(Commands.literal("create").executes(ctx->open(ctx.getSource(),1)))
            .then(Commands.literal("mine").executes(ctx->open(ctx.getSource(),2)))
            .then(Commands.literal("claim").executes(ctx->action(ctx.getSource(),(player,service)->service.claim(player))))
            .then(Commands.literal("list").executes(ctx->action(ctx.getSource(),(player,service)-> {
                for(MarketService.Listing entry:service.listings()) player.sendSystemMessage(Component.literal(entry.id()+" | "+entry.name()+" offers "+entry.offer().getCount()+" x "+entry.offer().getHoverName().getString()+" for "+entry.count()+" x "+entry.want().getHoverName().getString()+" (exact components)"));
                return new MarketService.Result(true,"Use /market buy <id> or /market cancel <id>; both require confirmation.");
            })))
            .then(Commands.literal("buy").then(Commands.argument("id",StringArgumentType.word()).executes(ctx->action(ctx.getSource(),(player,service)->service.stage(player,null,parse(StringArgumentType.getString(ctx,"id")),false)))))
            .then(Commands.literal("cancel").then(Commands.argument("id",StringArgumentType.word()).executes(ctx->action(ctx.getSource(),(player,service)->service.stage(player,null,parse(StringArgumentType.getString(ctx,"id")),true)))))
            .then(Commands.literal("confirm").then(Commands.argument("token",StringArgumentType.word()).executes(ctx->action(ctx.getSource(),(player,service)->service.confirm(player,StringArgumentType.getString(ctx,"token"))))))
            .then(Commands.literal("sell").then(Commands.argument("offered",IntegerArgumentType.integer(1,99))
                .then(Commands.argument("wanted",ItemArgument.item(registry)).then(Commands.argument("count",IntegerArgumentType.integer(1,4096)).executes(ctx->action(ctx.getSource(),(player,service)-> {
                    int slot=player.getInventory().getSelectedSlot(); ItemStack actual=player.getInventory().getItem(slot);
                    if(actual.isEmpty()) return new MarketService.Result(false,"Hold the item you want to offer in your main hand.");
                    return service.stage(player,new MarketService.Draft(slot,actual,IntegerArgumentType.getInteger(ctx,"offered"),ItemArgument.getItem(ctx,"wanted").createItemStack(1),IntegerArgumentType.getInteger(ctx,"count")),null,false);
                })))))));
    }
    private static UUID parse(String value) { try { return UUID.fromString(value); } catch(IllegalArgumentException invalid) { return null; } }
    private static int open(CommandSourceStack source,int page) throws CommandSyntaxException {
        return action(source,(player,service)-> {
            if(!player.isAlive() || player.isSpectator()) return new MarketService.Result(false,"Open the market after respawning and outside spectator mode.");
            if(page==1) MarketMenus.create(player,service); else if(page==2) MarketMenus.mine(player,service); else MarketMenus.board(player,service);
            return null;
        });
    }
    private static int action(CommandSourceStack source,Action action) throws CommandSyntaxException {
        ServerPlayer player=source.getPlayerOrException(); MarketService service=ServerMarket.service(source.getServer());
        if(service==null || !service.available()) { source.sendFailure(Component.literal("Market storage is unavailable. Escrow was not reset.")); return 0; }
        MarketService.Result result=action.run(player,service);
        if(result==null) return 1;
        player.sendSystemMessage(Component.literal(result.message())); return result.success()?1:0;
    }
}
