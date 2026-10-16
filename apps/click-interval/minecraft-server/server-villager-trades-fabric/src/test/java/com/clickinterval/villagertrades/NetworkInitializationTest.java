package com.clickinterval.villagertrades;

import org.junit.jupiter.api.Test;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

final class NetworkInitializationTest {
    @Test void onlyIntegratedClientWithAddonDefersToExistingCodecOwner() {
        assertTrue(NetworkInitialization.clientOwnsCodecs(true, true));
        assertFalse(NetworkInitialization.clientOwnsCodecs(true, false));
        assertFalse(NetworkInitialization.clientOwnsCodecs(false, true));
        assertFalse(NetworkInitialization.clientOwnsCodecs(false, false));
    }
    @Test void openingAndClosingMultipleWorldsRegistersReceiverOnlyOnce() {
        var initialization = new NetworkInitialization();
        var registrations = new AtomicInteger();
        for (int worlds = 0; worlds < 100; worlds++) initialization.once(registrations::incrementAndGet);
        assertEquals(1, registrations.get());
    }
    @Test void failedInitializationDoesNotPretendItRegistered() {
        var initialization = new NetworkInitialization();
        assertThrows(IllegalStateException.class, () -> initialization.once(() -> { throw new IllegalStateException("fixture"); }));
        var registrations = new AtomicInteger();
        initialization.once(registrations::incrementAndGet);
        assertEquals(1, registrations.get());
    }
}
