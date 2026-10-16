package com.clickinterval.lavasource;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.gamerules.GameRules;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Enables Minecraft's native renewable-lava behavior once when a server starts.
 *
 * <p>The native game rule performs source conversion as part of ordinary fluid updates. This mod
 * deliberately has no tick callback, entity marker, command, mixin, or world scan.</p>
 */
public final class SafeLavaSourceFabric implements ModInitializer {
    public static final String MOD_ID = "mr_lava_source";
    public static final String VERSION = "2.0.0";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTED.register(SafeLavaSourceFabric::enableNativeLavaSources);
    }

    private static void enableNativeLavaSources(MinecraftServer server) {
        try {
            boolean alreadyEnabled = server.getGameRules().get(GameRules.LAVA_SOURCE_CONVERSION);
            if (!alreadyEnabled) {
                // GameRules#set updates the native saved-data map and marks it dirty, so the value
                // is written with the world by Minecraft's normal save/autosave path.
                server.getGameRules().set(GameRules.LAVA_SOURCE_CONVERSION, true, server);
            }
            LOGGER.info(
                    "Lava Source {} active: native lava_source_conversion is enabled and persistent (changed={}).",
                    VERSION,
                    !alreadyEnabled);
        } catch (RuntimeException error) {
            // A compatibility failure must never prevent the Minecraft server from starting.
            LOGGER.error("Could not enable native lava_source_conversion; server startup will continue.", error);
        }
    }
}
