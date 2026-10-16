package dev.serverenchantments.fabric;
import com.mojang.serialization.JsonOps;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
final class PlacedLogsTest {
    @Test void placedBuildingsRemainExcludedAcrossSaveLoadAndNormalBreakRemovesMarker() {
        PlacedLogs data=PlacedLogs.TYPE.constructor().get();
        data.add(123L);
        data.add(-77L);
        assertTrue(data.isDirty());
        var encoded=PlacedLogs.CODEC.encodeStart(JsonOps.INSTANCE,data).getOrThrow();
        PlacedLogs restored=PlacedLogs.CODEC.parse(JsonOps.INSTANCE,encoded).getOrThrow();
        assertTrue(restored.contains(123L));
        assertTrue(restored.contains(-77L));
        assertFalse(restored.contains(99L));
        restored.remove(123L);
        assertFalse(restored.contains(123L));
    }
    @Test void saturationFailsClosedInsteadOfDroppingProtectionMarkers() {
        PlacedLogs data=PlacedLogs.TYPE.constructor().get();
        for(long i=0;i<=PlacedLogs.LIMIT;i++) data.add(i);
        assertTrue(data.contains(Long.MAX_VALUE),"unknown logs remain protected after the cap is reached");
        var json=PlacedLogs.CODEC.encodeStart(JsonOps.INSTANCE,data).getOrThrow().getAsJsonObject();
        assertEquals(PlacedLogs.LIMIT,json.getAsJsonArray("positions").size());
        assertTrue(json.get("saturated").getAsBoolean());
    }
}
