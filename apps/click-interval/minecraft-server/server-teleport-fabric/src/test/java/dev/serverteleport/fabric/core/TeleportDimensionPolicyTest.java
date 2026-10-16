package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class TeleportDimensionPolicyTest {
    @Test void normalTravelSupportsSameAndCrossDimension() {
        String[] worlds = {"minecraft:overworld", "minecraft:the_nether", "minecraft:the_end", "custom:world"};
        for (String from : worlds) for (String to : worlds) {
            assertTrue(TeleportDimensionPolicy.allows(from, to));
        }
        assertFalse(TeleportDimensionPolicy.allows(null, "minecraft:overworld"));
        assertFalse(TeleportDimensionPolicy.allows("minecraft:overworld", null));
    }
}
