package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.Clock;
import com.clickinterval.anticheat.core.EnforcementAction;
import com.clickinterval.anticheat.core.EventLogger;
import com.clickinterval.anticheat.core.OffenseRecord;
import com.clickinterval.anticheat.core.OffenseStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

final class StateCompatibilityTest {
    @TempDir
    Path directory;

    @Test
    void writesTheSharedBoundedEventFormat() throws Exception {
        Path history = directory.resolve("events.jsonl");
        EventLogger logger = new EventLogger(history, ignored -> { });
        UUID id = UUID.randomUUID();
        logger.event("Alex", id, "combat.reach", "combat", EnforcementAction.KICK,
                "Reach", 17.0, 1, 0, Map.of("observed", "5.0"));
        logger.close();
        String line = Files.readString(history);
        assertTrue(line.contains("\"check\":\"combat.reach\""));
        assertTrue(line.contains("\"action\":\"kick\""));
        assertTrue(line.contains(id.toString()));
    }

    @Test
    void offensePropertiesRoundTripWithTheSharedEngine() throws Exception {
        Path file = directory.resolve("offenses.properties");
        UUID id = UUID.randomUUID();
        OffenseStore first = new OffenseStore(file, Clock.SYSTEM);
        first.observe(id, "Alex", "combat.reach", "Reach");
        first.punish(id, EnforcementAction.TEMP_BAN, 60, true);
        first.saveIfDirty();

        OffenseStore second = new OffenseStore(file, Clock.SYSTEM);
        second.load();
        OffenseRecord record = second.get(id);
        assertNotNull(record);
        assertEquals("Alex", record.name());
        assertEquals(1, record.offenseCount());
        assertTrue(record.temporaryBanUntil() > System.currentTimeMillis());
    }
}
