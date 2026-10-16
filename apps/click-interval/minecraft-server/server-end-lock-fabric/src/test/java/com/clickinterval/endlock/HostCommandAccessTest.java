package com.clickinterval.endlock;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class HostCommandAccessTest {
    private static final UUID HOST = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID GUEST = UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Test void integratedHostWithCheatsMayManage() {
        assertTrue(HostCommandAccess.allowed(false, HOST, HOST, true, true, true));
    }

    @Test void dedicatedPlayerNeverGainsConsolePowers() {
        assertFalse(HostCommandAccess.allowed(true, HOST, HOST, true, true, true));
    }

    @Test void lanOperatorOrSameNameWithDifferentUuidIsNotWorldHost() {
        assertFalse(HostCommandAccess.allowed(false, HOST, GUEST, true, true, true));
    }

    @Test void hostNeedsCheatsAndUnmodifiedPlayerSource() {
        assertFalse(HostCommandAccess.allowed(false, HOST, HOST, true, true, false));
        assertFalse(HostCommandAccess.allowed(false, HOST, HOST, true, false, true));
    }

    @Test void missingProfilePlayerOrVanillaOwnerFailsClosed() {
        assertFalse(HostCommandAccess.allowed(false, null, HOST, true, true, true));
        assertFalse(HostCommandAccess.allowed(false, HOST, null, true, true, true));
        assertFalse(HostCommandAccess.allowed(false, HOST, HOST, false, true, true));
    }

    @Test void everyRequiredGateFailsClosedAcrossAllCombinations() {
        for (int flags = 0; flags < 64; flags++) {
            boolean expected = flags == 62;
            assertEquals(expected, HostCommandAccess.allowed((flags & 1) != 0,
                    (flags & 2) != 0 ? HOST : null, (flags & 4) != 0 ? HOST : GUEST,
                    (flags & 8) != 0, (flags & 16) != 0, (flags & 32) != 0), "flags=" + flags);
        }
    }
}
