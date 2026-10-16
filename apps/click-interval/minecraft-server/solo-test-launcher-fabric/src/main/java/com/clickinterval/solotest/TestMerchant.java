package com.clickinterval.solotest;

import com.clickinterval.market.*;
import com.mojang.authlib.GameProfile;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.level.*;
import net.minecraft.server.network.*;
import net.minecraft.world.item.*;
import net.minecraft.world.level.GameType;

/** Offline synthetic fixture only: never joins a world, tab list, socket or online session. */
final class TestMerchant {
    static final UUID ID=UUID.nameUUIDFromBytes("ClickInterval:TreeChopTest:TestMerchant:v1".getBytes(StandardCharsets.UTF_8));
    static int create(CommandSourceStack source) {
        if(!TestHub.permitted(source)) return 0;
        var server=source.getServer(); MarketService market=ServerMarket.service(server);
        if(market==null || !market.available()) { source.sendFailure(Component.literal("Market is not ready; escrow left untouched.")); return 0; }
        if(server.getPlayerList().getPlayer(ID)!=null || source.getPlayer().getUUID().equals(ID)) throw new IllegalStateException("Synthetic identity is online");
        GameProfile profile=new GameProfile(ID,"TestMerchant");
        ServerPlayer merchant=new ServerPlayer(server,server.overworld(),profile,ClientInformation.createDefault());
        merchant.connection=new ServerGamePacketListenerImpl(server,new Connection(PacketFlow.SERVERBOUND),merchant,CommonListenerCookie.createInitial(profile,false));
        merchant.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        int created=0;
        try {
            if(market.listings().stream().noneMatch(listing->listing.seller().equals(ID))) {
                ItemStack offer=new ItemStack(Items.IRON_INGOT,4); merchant.getInventory().setItem(0,offer.copy());
                MarketService.Result result=market.post(merchant,new MarketService.Draft(0,offer,4,new ItemStack(Items.DIAMOND),1));
                if(!result.success()) { source.sendFailure(Component.literal(result.message())); return 0; }
                created++; market.onDisconnect(merchant);
            }
            if(market.auctions().active().stream().noneMatch(auction->auction.seller().equals(ID))) {
                ItemStack offer=new ItemStack(Items.EMERALD); merchant.getInventory().setItem(0,offer.copy());
                MarketService.Result result=market.auctions().create(merchant,new AuctionService.Draft(new MarketService.Draft(0,offer,1,new ItemStack(Items.DIAMOND),1),60_000));
                if(!result.success()) { source.sendFailure(Component.literal(result.message())); return 0; }
                created++;
            }
            int count=created;
            source.sendSuccess(()->Component.literal("TestMerchant: "+count+" new demos. /market: 4 iron for 1 diamond. /ah: 1 emerald, minimum 1 diamond, 60 seconds. Existing offers and claims preserved."),false);
            return 1;
        } finally { market.onDisconnect(merchant); }
    }
}
