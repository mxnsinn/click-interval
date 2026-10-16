package dev.servertradeassistant.fabric;

import dev.servertradeassistant.fabric.network.EntityLabelPermissionPayload;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;

public final class ServerTradeAssistantFabric implements ModInitializer {
    @Override
    public void onInitialize() {
        PayloadTypeRegistry.clientboundPlay().register(
                EntityLabelPermissionPayload.TYPE, EntityLabelPermissionPayload.CODEC);
        ServerTradeAssistantRuntime runtime = ServerTradeAssistantRuntime.initialize();
        ServerLifecycleEvents.SERVER_STARTED.register(runtime::serverStarted);
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> runtime.serverStopped());
        ServerTickEvents.END_SERVER_TICK.register(runtime::serverTick);
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) ->
                runtime.refreshEntityLabelPermission(handler.getPlayer(), true));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) ->
                runtime.forgetPlayer(handler.getPlayer()));
    }
}
