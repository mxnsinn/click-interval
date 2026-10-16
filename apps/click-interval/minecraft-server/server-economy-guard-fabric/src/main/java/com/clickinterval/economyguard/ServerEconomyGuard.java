package com.clickinterval.economyguard;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.world.level.storage.LevelResource;
import java.nio.file.Files;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class ServerEconomyGuard implements ModInitializer {
    public static final Logger LOGGER = LoggerFactory.getLogger("ServerEconomyGuard");
    @Override public void onInitialize() {
        LOGGER.info("Economy Guard 1.0.0: falling-block portal, stale tripwire and removed container-vehicle guards active; no scans or inventory confiscation.");
        if (Boolean.getBoolean("servereconomyguard.selftest")) {
            ServerLifecycleEvents.SERVER_STARTED.register(server -> {
                // A second explicit marker prevents an accidental selftest flag from modifying real saves.
                if (!Files.isRegularFile(server.getWorldPath(LevelResource.ROOT).resolve(".economy-guard-disposable-test"))) {
                    throw new IllegalStateException("Economy Guard selftests require a marked disposable world");
                }
                BlockGuardSelfTest.run(server);
                PortalGuardSelfTest.run(server);
                ContainerGuardSelfTest.run(server);
                LOGGER.info("SERVER_ECONOMY_GUARD_SELFTEST_PASS");
            });
        }
    }
}
