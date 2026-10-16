package dev.serverprotection.client;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

public final class IrisShadowPassTest {
    @Test
    void missingOrChangedOptionalProviderPreservesNormalRendering() {
        assertFalse(probe("uninstalled.iris.ShadowRenderingState").active());
        assertFalse(probe(WrongSignature.class.getName()).active());
        assertFalse(probe(InstanceMethod.class.getName()).active());
    }

    @Test
    void resolvedProviderIsQueriedEveryFrameAndOnlyShadowsAreSkipped() {
        SwitchingProvider.shadow = false;
        IrisShadowPass probe = probe(SwitchingProvider.class.getName());
        assertFalse(probe.active());
        SwitchingProvider.shadow = true;
        assertTrue(probe.active());
        SwitchingProvider.shadow = false;
        assertFalse(probe.active());
    }

    @Test
    void incompatibleProviderIsDisabledAfterItsFirstFailure() {
        BrokenProvider.calls.set(0);
        IrisShadowPass probe = probe(BrokenProvider.class.getName());
        for (int frame = 0; frame < 100; frame++) assertFalse(probe.active());
        assertEquals(1, BrokenProvider.calls.get());
    }

    @Test
    void absentProviderIsLookedUpOnlyOnce() {
        AtomicInteger lookups = new AtomicInteger();
        ClassLoader missing = new ClassLoader(null) {
            @Override
            protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
                lookups.incrementAndGet();
                throw new ClassNotFoundException(name);
            }
        };
        IrisShadowPass probe = IrisShadowPass.resolve("absent.Shadows", missing);
        for (int frame = 0; frame < 100; frame++) assertFalse(probe.active());
        assertEquals(1, lookups.get());
    }

    private static IrisShadowPass probe(String providerClass) {
        return IrisShadowPass.resolve(providerClass, IrisShadowPassTest.class.getClassLoader());
    }

    public static final class SwitchingProvider {
        static boolean shadow;
        public static boolean areShadowsCurrentlyBeingRendered() { return shadow; }
    }

    public static final class WrongSignature {
        public static String areShadowsCurrentlyBeingRendered() { return "yes"; }
    }

    public static final class InstanceMethod {
        public boolean areShadowsCurrentlyBeingRendered() { return true; }
    }

    public static final class BrokenProvider {
        static final AtomicInteger calls = new AtomicInteger();
        public static boolean areShadowsCurrentlyBeingRendered() {
            calls.incrementAndGet();
            throw new NoClassDefFoundError("optional rendering dependency unavailable");
        }
    }
}
