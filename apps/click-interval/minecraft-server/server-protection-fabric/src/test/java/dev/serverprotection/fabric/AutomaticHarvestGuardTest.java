package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class AutomaticHarvestGuardTest {
    @Test void absentModNeverExemptsNormalMining() throws Exception {
        AutomaticHarvestGuard guard=AutomaticHarvestGuard.load(false,null,Object.class);
        assertFalse(guard.isAutomaticBreak(new Object()));
        assertFalse(guard.isAutomaticBreak(null));
    }
    @Test void onlyTheExactServerAuthorizedPlayerIsExemptDuringTheSynchronousCall() throws Exception {
        AutomaticHarvestGuard guard=AutomaticHarvestGuard.fromProvider(Provider.class,Object.class);
        Object first=new Object();
        Object second=new Object();
        assertFalse(guard.isAutomaticBreak(first));
        Provider.active=first;
        try {
            assertTrue(guard.isAutomaticBreak(first));
            assertFalse(guard.isAutomaticBreak(second));
            assertFalse(guard.isAutomaticBreak(null));
        } finally { Provider.active=null; }
        assertFalse(guard.isAutomaticBreak(first));
    }
    @Test void aBrokenOptionalProviderFailsClosed() throws Exception {
        AutomaticHarvestGuard guard=AutomaticHarvestGuard.fromProvider(Broken.class,Object.class);
        assertFalse(guard.isAutomaticBreak(new Object()));
        assertThrows(NoSuchMethodException.class,()->AutomaticHarvestGuard.fromProvider(String.class,Object.class));
    }
    public static final class Provider {
        static Object active;
        public static boolean isAutomaticBreak(Object player) { return active!=null && player==active; }
    }
    public static final class Broken {
        public static boolean isAutomaticBreak(Object player) { throw new IllegalStateException("provider unavailable"); }
    }
}
