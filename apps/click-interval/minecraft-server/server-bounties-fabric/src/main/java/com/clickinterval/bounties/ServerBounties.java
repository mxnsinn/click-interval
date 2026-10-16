package com.clickinterval.bounties;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.IdentityHashMap;
import java.util.Map;

public final class ServerBounties implements ModInitializer {
    public static final Logger LOGGER=LoggerFactory.getLogger("serverbounties_fabric");
    private static final Map<MinecraftServer,BountyService> SERVICES=new IdentityHashMap<>();
    public static BountyService service(MinecraftServer server) { return SERVICES.get(server); }
    @Override public void onInitialize() {
        CommandRegistrationCallback.EVENT.register((dispatcher,registry,environment)->BountyCommands.register(dispatcher));
        ServerLifecycleEvents.SERVER_STARTED.register(server->{
            try { SERVICES.put(server,new BountyService(server)); LOGGER.info("Server Bounties 1.1.1 ready: grouped owner bounties, snapshot-safe refunds and vanilla chest menus"); }
            catch(Exception failure) { LOGGER.error("Bounties disabled; existing escrow was NOT reset",failure); }
        });
        ServerLifecycleEvents.SERVER_STOPPED.register(SERVICES::remove);
        ServerPlayConnectionEvents.JOIN.register((handler,sender,server)->{ BountyService service=service(server); if(service!=null) service.onJoin(handler.getPlayer()); });
        ServerPlayConnectionEvents.DISCONNECT.register((handler,server)->{ BountyService service=service(server); if(service!=null) service.onDisconnect(handler.getPlayer()); });
        ServerLivingEntityEvents.AFTER_DEATH.register((entity,source)->{
            if(entity instanceof ServerPlayer victim && source.getEntity() instanceof ServerPlayer killer) {
                BountyService service=service(victim.level().getServer()); if(service!=null) service.onKill(victim,killer);
            }
        });
        if(Boolean.getBoolean("serverbounties.selftest")) ServerLifecycleEvents.SERVER_STARTED.register(server->{
            BountyService service=service(server);
            if(service!=null) BountySelfTest.run(server,service);
            else LOGGER.error("SERVER_BOUNTIES_NATIVE_TEST_FAIL: service initialization failed");
        });
    }
}
