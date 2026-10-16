package dev.serverenchantments.fabric;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

final class NewEnchantmentResourcesTest {
    @Test void harvestHasThreeHoeOnlyLevelsAndLiteralName() throws Exception {
        check("harvester_sweep", "Harvester Sweep", "#minecraft:hoes", 3);
    }

    @Test void smelterIsOnePickaxeOnlyLevelAndExcludesSilkTouch() throws Exception {
        JsonObject data=check("smelter", "Smelter", "#minecraft:pickaxes", 1);
        assertTrue(data.has("exclusive_set"), "native anvil/table selection must enforce incompatibility");
        assertTrue(data.get("exclusive_set").toString().contains("minecraft:silk_touch"));
    }

    @Test void rejectedIdeasAreNotPublished() {
        for (String name : new String[]{"magnetism", "last_stand"})
            assertNull(getClass().getClassLoader().getResource("data/serverenchantments/enchantment/"+name+".json"));
    }

    private JsonObject check(String id, String name, String tools, int levels) throws IOException {
        JsonObject data=read("data/serverenchantments/enchantment/"+id+".json");
        assertEquals(name,data.getAsJsonObject("description").get("text").getAsString());
        assertEquals(tools,data.get("supported_items").getAsString());
        assertEquals(levels,data.get("max_level").getAsInt());
        assertEquals(1,data.get("weight").getAsInt());
        assertTrue(data.get("anvil_cost").getAsInt()>0);
        for(int level=1;level<=levels;level++) {
            int min=cost(data.getAsJsonObject("min_cost"),level);
            int max=cost(data.getAsJsonObject("max_cost"),level);
            assertTrue(min>0 && max>=min,"valid native cost band at level "+level);
        }
        for(String pool:new String[]{"tradeable","in_enchanting_table"}) {
            JsonObject tag=read("data/minecraft/tags/enchantment/"+pool+".json");
            assertFalse(tag.get("replace").getAsBoolean());
            assertTrue(tag.getAsJsonArray("values").asList().stream().anyMatch(v->v.getAsString().equals("serverenchantments:"+id)));
        }
        return data;
    }

    private int cost(JsonObject cost,int level) {
        return cost.get("base").getAsInt()+cost.get("per_level_above_first").getAsInt()*(level-1);
    }

    private JsonObject read(String path) throws IOException {
        try(var stream=getClass().getClassLoader().getResourceAsStream(path)) {
            assertNotNull(stream,path);
            return JsonParser.parseString(new String(stream.readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();
        }
    }
}
