package com.clickinterval.villagertrades;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Stock support only. Original Trade Cycling owns its own button, packets and reroll implementation. */
public final class ServerVillagerTrades implements ModInitializer {
    public static final Logger LOGGER = LoggerFactory.getLogger("server_villager_trades");

    @Override
    public void onInitialize() {
        LOGGER.info("Unlimited paid villager stock enabled; original Trade Cycling compatibility active when installed. Custom cycling UI/network disabled.");
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> OriginalTradeGuard.disconnect(handler.player));
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> OriginalTradeGuard.stop());
        if (Boolean.getBoolean("servervillagertrades.selftest")) {
            if (!java.nio.file.Files.isRegularFile(java.nio.file.Path.of(".villager-trades-disposable-test"))) {
                throw new IllegalStateException("Villager self-tests require .villager-trades-disposable-test in the disposable server working directory");
            }
            ServerLifecycleEvents.SERVER_STARTED.register(VillagerTradeSelfTest::run);
        }
    }
}
