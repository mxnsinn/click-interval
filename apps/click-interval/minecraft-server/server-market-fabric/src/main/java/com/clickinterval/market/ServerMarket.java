package com.clickinterval.market;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.*;

public final class ServerMarket implements ModInitializer {
    public static final Logger LOGGER=LoggerFactory.getLogger("servermarket_fabric");
    private static final Map<MinecraftServer,MarketService> SERVICES=new IdentityHashMap<>();
    public static MarketService service(MinecraftServer server) { return SERVICES.get(server); }
    @Override public void onInitialize() {
        CommandRegistrationCallback.EVENT.register((dispatcher,registry,environment)-> { MarketCommands.register(dispatcher,registry); AuctionCommands.register(dispatcher,registry); });
        ServerLifecycleEvents.SERVER_STARTED.register(server->{
            try {
                MarketService service=new MarketService(server);
                WantedItemCatalog.get(server);
                SERVICES.put(server,service);
                LOGGER.info("Server Market 1.1.0 ready: categorized wanted-item browser, exact-item barter and persisted escrow");
            }
            catch(Exception failure) { LOGGER.error("Market initialization failed closed; escrow was NOT reset. Player joins are blocked until recovery.",failure); }
            if(Boolean.getBoolean("servermarket.selftest")) {
                MarketSelfTest.run(server,service(server));
                // Native tests deliberately create fresh service instances to
                // simulate restart. Do not leave the original cached view live.
                try { SERVICES.put(server,new MarketService(server)); }
                catch(Exception failure) { SERVICES.remove(server); LOGGER.error("Market fixture recovery failed",failure); }
            }
        });
        ServerLifecycleEvents.SERVER_STOPPED.register(server->{ SERVICES.remove(server); WantedItemCatalog.invalidate(server); });
        ServerLifecycleEvents.END_DATA_PACK_RELOAD.register((server,resources,success)-> {
            if(success) { WantedItemCatalog.invalidate(server); WantedItemCatalog.get(server); }
        });
        ServerTickEvents.END_SERVER_TICK.register(server-> {
            if(server.getTickCount()%20==0) { MarketService service=service(server); if(service!=null) service.auctions().settleExpired(); }
        });
        ServerPlayConnectionEvents.JOIN.register((handler,sender,server)-> {
            MarketService service=service(server);
            // An unresolved journal must never allow its player to spend the
            // journalled inventory or lose its marker before recovery.
            if(service==null || !service.available()) handler.getPlayer().connection.disconnect(Component.literal("Market storage needs recovery. Ask the server owner to restore safe storage access; escrow has not been reset."));
            else service.onJoin(handler.getPlayer());
        });
        ServerPlayConnectionEvents.DISCONNECT.register((handler,server)-> { MarketService service=service(server); if(service!=null) service.onDisconnect(handler.getPlayer()); });
    }
}
