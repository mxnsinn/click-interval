package dev.serverenchantments.fabric;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;
final class ResourceContractTest {
    @Test void dedicatedAndIntegratedServersUseCommonEntrypointAndMixins() throws Exception {
        var metadata=JsonParser.parseString(read("fabric.mod.json")).getAsJsonObject();
        assertEquals("*",metadata.get("environment").getAsString());
        assertTrue(metadata.getAsJsonObject("entrypoints").has("main"));
        assertFalse(metadata.getAsJsonObject("entrypoints").has("client"));
        var mixins=JsonParser.parseString(read("serverenchantments.mixins.json")).getAsJsonObject();
        assertFalse(mixins.has("client"));
        assertTrue(mixins.getAsJsonArray("mixins").asList().stream().anyMatch(v->v.getAsString().equals("AnvilMenuMixin")));
        for(String binary:new String[]{"ServerEnchantmentsFabric","mixin/PlacedLogMixin","mixin/AnvilMenuMixin","mixin/CompletedBlockBreakMixin"})
            assertFalse(read("dev/serverenchantments/fabric/"+binary+".class").contains("net/minecraft/client/"));
    }
    @Test void requiredCommonReturnHookDefersHarvestUntilOriginalDurabilityAndLootComplete() throws Exception {
        var metadata=JsonParser.parseString(read("serverenchantments.mixins.json")).getAsJsonObject();
        assertTrue(metadata.get("required").getAsBoolean());
        assertEquals(1,metadata.getAsJsonObject("injectors").get("defaultRequire").getAsInt());
        assertTrue(metadata.getAsJsonArray("mixins").asList().stream().anyMatch(v->v.getAsString().equals("CompletedBlockBreakMixin")));
        String hook=read("dev/serverenchantments/fabric/mixin/CompletedBlockBreakMixin.class");
        for(String symbol:new String[]{"ServerPlayerGameMode","destroyBlock","RETURN","finishNativeBreak","getReturnValueZ"})
            assertTrue(hook.contains(symbol),"compiled native completion hook must contain "+symbol);
        assertFalse(hook.contains("HEAD"),"native durability and drops cannot be bypassed by dispatching at method entry");
        String source=Files.readString(Path.of("src/main/java/dev/serverenchantments/fabric/ServerEnchantmentsFabric.java"));
        int captureStart=source.indexOf("private void afterBreak(");
        int captureEnd=source.indexOf("void beginTick(",captureStart);
        assertTrue(captureStart>=0 && captureEnd>captureStart);
        String capture=source.substring(captureStart,captureEnd);
        assertTrue(capture.contains("jobs.put("),"Fabric AFTER captures only a pending candidate");
        assertFalse(capture.contains("drainJobs("),"Fabric AFTER precedes original vanilla tool damage: dispatch must wait for RETURN");
        assertTrue(source.contains("candidate.awaitingNativeReturn") && source.contains("candidate.origin.equals(pos)"),
                "native completion must release only the matching pending original block");
    }
    @Test void rareDataDrivenEnchantmentsAreToolSpecificAndAvailableInVanillaPools() throws Exception {
        for(String name:new String[]{"cheery_chop","wide_miner"}) {
            var enchant=JsonParser.parseString(read("data/serverenchantments/enchantment/"+name+".json")).getAsJsonObject();
            assertEquals(1,enchant.get("weight").getAsInt());
            assertEquals(name.equals("cheery_chop")?1:2,enchant.get("max_level").getAsInt());
            assertEquals(25,enchant.getAsJsonObject("min_cost").get("base").getAsInt());
            assertEquals(name.equals("cheery_chop")?"#minecraft:axes":"#minecraft:pickaxes",enchant.get("supported_items").getAsString());
            assertTrue(enchant.getAsJsonObject("description").has("text"),"unmodified clients need a literal fallback name");
            assertEquals(name.equals("cheery_chop")?"Tree Chop":"Miner's Sweep",
                    enchant.getAsJsonObject("description").get("text").getAsString(),
                    "correct display names must keep their published registry IDs");
            for(String pool:new String[]{"tradeable","in_enchanting_table"}) {
                var tag=JsonParser.parseString(read("data/minecraft/tags/enchantment/"+pool+".json")).getAsJsonObject();
                assertFalse(tag.get("replace").getAsBoolean());
                assertTrue(tag.getAsJsonArray("values").asList().stream().anyMatch(v->v.getAsString().equals("serverenchantments:"+name)));
            }
        }
    }
    @Test void sweepSecondLevelUsesTheSameVanillaRegistryEntryAndValidEnchantingCosts() throws Exception {
        var enchant=JsonParser.parseString(read("data/serverenchantments/enchantment/wide_miner.json")).getAsJsonObject();
        assertEquals(2,enchant.get("max_level").getAsInt());
        int minimum=enchant.getAsJsonObject("min_cost").get("base").getAsInt();
        int maximum=enchant.getAsJsonObject("max_cost").get("base").getAsInt();
        int minStep=enchant.getAsJsonObject("min_cost").get("per_level_above_first").getAsInt();
        int maxStep=enchant.getAsJsonObject("max_cost").get("per_level_above_first").getAsInt();
        assertTrue(minimum>0 && maximum>=minimum);
        assertTrue(minStep>=0 && maxStep>=0 && maximum+maxStep>=minimum+minStep);
        assertTrue(enchant.get("anvil_cost").getAsInt()>0,"native book combination must retain a real XP cost");
        assertNull(getClass().getClassLoader().getResource("data/serverenchantments/enchantment/wide_miner_ii.json"),
                "level II must upgrade existing level I items, not create an incompatible duplicate ID");
    }
    @Test void displayNameCorrectionDoesNotCreateADuplicateTreeEnchantment() {
        assertNull(getClass().getClassLoader().getResource("data/serverenchantments/enchantment/tree_chop.json"),
                "renaming the registry ID would orphan existing tools, books, and villager offers");
    }
    @Test void pickaxeRenameKeepsPublishedWideMinerRegistryId() throws Exception {
        assertNotNull(getClass().getClassLoader().getResource("data/serverenchantments/enchantment/wide_miner.json"));
        assertNull(getClass().getClassLoader().getResource("data/serverenchantments/enchantment/miners_sweep.json"),
                "display rename must not create a replacement ID or duplicate existing books/trades");
        assertNull(getClass().getClassLoader().getResource("data/serverenchantments/enchantment/miner_sweep.json"));
        assertTrue(read("data/serverenchantments/enchantment/wide_miner.json").contains("Miner's Sweep"));
    }
    private String read(String name) throws IOException {
        try(InputStream stream=getClass().getClassLoader().getResourceAsStream(name)) {
            assertNotNull(stream,name);
            return new String(stream.readAllBytes(),StandardCharsets.UTF_8);
        }
    }
}
