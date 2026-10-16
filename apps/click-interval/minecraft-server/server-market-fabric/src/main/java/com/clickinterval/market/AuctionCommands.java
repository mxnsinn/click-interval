package com.clickinterval.market;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.minecraft.commands.*;
import net.minecraft.commands.arguments.item.ItemArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import java.util.UUID;

final class AuctionCommands {
    private AuctionCommands() {}
    @FunctionalInterface private interface Action { MarketService.Result run(ServerPlayer player,MarketService market) throws CommandSyntaxException; }
    static void register(CommandDispatcher<CommandSourceStack> dispatcher,CommandBuildContext registry) {
        dispatcher.register(root("auctionhouse",registry)); dispatcher.register(root("ah",registry));
    }
    private static LiteralArgumentBuilder<CommandSourceStack> root(String name,CommandBuildContext registry) {
        return Commands.literal(name).executes(ctx->open(ctx.getSource(),0))
            .then(Commands.literal("create").executes(ctx->open(ctx.getSource(),1)))
            .then(Commands.literal("mine").executes(ctx->open(ctx.getSource(),2)))
            .then(Commands.literal("claim").executes(ctx->action(ctx.getSource(),(player,market)->market.claim(player))))
            .then(Commands.literal("list").executes(ctx->action(ctx.getSource(),(player,market)-> {
                market.auctions().settleExpired();
                for(AuctionService.Auction auction:market.auctions().active()) player.sendSystemMessage(Component.literal(auction.id()+" | seller "+auction.name()+" offers "+auction.offer().getCount()+" x "+auction.offer().getHoverName().getString()+" | exact payment "+auction.want().getHoverName().getString()+" | min "+auction.minimum()+" | highest "+auction.highest()+" by "+auction.bidderName()+" | remaining "+AuctionMenus.remaining(auction,market.auctions())));
                return new MarketService.Result(true,"Use /ah bid <id> <amount>; then confirm its one-time token.");
            })))
            .then(Commands.literal("bid").then(Commands.argument("id",StringArgumentType.word()).then(Commands.argument("amount",IntegerArgumentType.integer(1,4096)).executes(ctx->action(ctx.getSource(),(player,market)->market.auctions().stage(player,null,id(StringArgumentType.getString(ctx,"id")),IntegerArgumentType.getInteger(ctx,"amount"),false))))))
            .then(Commands.literal("cancel").then(Commands.argument("id",StringArgumentType.word()).executes(ctx->action(ctx.getSource(),(player,market)->market.auctions().stage(player,null,id(StringArgumentType.getString(ctx,"id")),0,true)))))
            .then(Commands.literal("confirm").then(Commands.argument("token",StringArgumentType.word()).executes(ctx->action(ctx.getSource(),(player,market)->market.auctions().confirm(player,StringArgumentType.getString(ctx,"token"))))))
            .then(Commands.literal("sell").then(Commands.argument("offered",IntegerArgumentType.integer(1,99))
                .then(Commands.argument("wanted",ItemArgument.item(registry)).then(Commands.argument("minimum",IntegerArgumentType.integer(1,4096))
                    .then(Commands.argument("minutes",IntegerArgumentType.integer(1,10080)).executes(ctx->action(ctx.getSource(),(player,market)-> {
                        int slot=player.getInventory().getSelectedSlot(); ItemStack offer=player.getInventory().getItem(slot);
                        if(offer.isEmpty()) return new MarketService.Result(false,"Hold the offered item in your main hand.");
                        MarketService.Draft items=new MarketService.Draft(slot,offer,IntegerArgumentType.getInteger(ctx,"offered"),ItemArgument.getItem(ctx,"wanted").createItemStack(1),IntegerArgumentType.getInteger(ctx,"minimum"));
                        return market.auctions().stage(player,new AuctionService.Draft(items,IntegerArgumentType.getInteger(ctx,"minutes")*60_000L),null,0,false);
                    })))))));
    }
    private static UUID id(String value) { try { return UUID.fromString(value); } catch(IllegalArgumentException invalid) { return null; } }
    private static int open(CommandSourceStack source,int page) throws CommandSyntaxException {
        return action(source,(player,market)-> {
            if(!player.isAlive() || player.isSpectator()) return new MarketService.Result(false,"Open auctions after respawning and outside spectator mode.");
            if(page==1) AuctionMenus.create(player,market); else if(page==2) AuctionMenus.mine(player,market); else AuctionMenus.board(player,market); return null;
        });
    }
    private static int action(CommandSourceStack source,Action action) throws CommandSyntaxException {
        ServerPlayer player=source.getPlayerOrException(); MarketService market=ServerMarket.service(source.getServer());
        if(market==null || !market.available()) { source.sendFailure(Component.literal("Auction storage is unavailable; escrow is preserved.")); return 0; }
        MarketService.Result result=action.run(player,market); if(result==null) return 1;
        player.sendSystemMessage(Component.literal(result.message())); return result.success()?1:0;
    }
}
