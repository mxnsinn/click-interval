package com.clickinterval.villagertrades;

import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

final class StockIntegrationContractTest {
    @Test void backendSupportsIntegratedAndDedicatedWithoutBundlingClientEntrypoint() throws Exception {
        try (var stream = getClass().getClassLoader().getResourceAsStream("fabric.mod.json")) {
            assertNotNull(stream);
            var metadata = JsonParser.parseString(new String(stream.readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject();
            assertEquals("*", metadata.get("environment").getAsString());
            assertTrue(metadata.getAsJsonObject("entrypoints").has("main"));
            assertFalse(metadata.getAsJsonObject("entrypoints").has("client"));
        }
        String initializer = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/ServerVillagerTrades.java"));
        assertFalse(initializer.contains("registerNetwork"));
        assertFalse(initializer.contains("PayloadTypeRegistry"));
        assertFalse(initializer.contains("registerGlobalReceiver"));
        assertTrue(initializer.contains("SERVER_STOPPED.register(server -> OriginalTradeGuard.stop())"));
    }
    @Test void exactMappedOfferHooksRemainLazyAndDoNotResetTradeEvidence() throws Exception {
        try (var stream = getClass().getClassLoader().getResourceAsStream("net/minecraft/world/entity/npc/villager/Villager.class")) {
            assertNotNull(stream); var node = new ClassNode(); new ClassReader(stream).accept(node, 0);
            assertTrue(node.methods.stream().anyMatch(m -> m.name.equals("setOffers") && m.desc.equals("(Lnet/minecraft/world/item/trading/MerchantOffers;)V")));
        }
        String mixin = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/mixin/VillagerAssignedStockMixin.java"));
        assertTrue(mixin.contains("instanceof ServerLevel"));
        for (var forbidden : new String[]{"resetUses(", "setVillagerXp(", "getAllEntities(", "getEntities("}) assertFalse(mixin.contains(forbidden));
        String getter = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/mixin/AbstractVillagerOffersMixin.java"));
        assertTrue(getter.contains("instanceof Villager villager && villager.level() instanceof ServerLevel"));
    }
    @Test void activeMixinsAndDefaultBuildRetireCustomCyclingWithoutDeletingLegacySources() throws Exception {
        var mixins = JsonParser.parseString(Files.readString(Path.of("src/main/resources/server-villager-trades.mixins.json")))
                .getAsJsonObject().getAsJsonArray("mixins").toString();
        assertTrue(mixins.contains("VillagerAssignedStockMixin"));
        assertTrue(mixins.contains("OriginalTradeCyclingGuardMixin"));
        for (String legacy : new String[]{"VillagerCyclingMixin", "VillagerTradingAccess", "MerchantMenuCycleMixin"})
            assertFalse(mixins.contains(legacy));
        String build = Files.readString(Path.of("build.gradle"));
        assertFalse(build.contains("dependsOn tasks.named('clientAddonJar')"));
        assertTrue(Files.isRegularFile(Path.of("src/main/java/com/clickinterval/villagertrades/client/MerchantScreenMixin.java")));
        String guard = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/mixin/OriginalTradeCyclingGuardMixin.java"));
        assertTrue(guard.contains("@Pseudo"));
        assertTrue(guard.contains("de.maxhenkel.tradecycling.TradeCyclingMod"));
        String policy = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/OriginalTradeGuard.java"));
        for (String legacy : new String[]{"CycleRequest", "CycleStatus", "nonce", "JOB_SITE", "hasLineOfSight", "getSlot("})
            assertFalse(policy.contains(legacy), legacy);
    }
}
