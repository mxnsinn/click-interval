package dev.serverprotection.client;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

/** Optional Iris integration; the provider is resolved once, never on the per-cape hot path. */
public final class IrisShadowPass {
    private static final IrisShadowPass IRIS = resolve(
            "net.irisshaders.iris.shadows.ShadowRenderingState", IrisShadowPass.class.getClassLoader());

    private volatile MethodHandle query;

    private IrisShadowPass(MethodHandle query) {
        this.query = query;
    }

    public static boolean isActive() {
        return IRIS.active();
    }

    static IrisShadowPass resolve(String providerClass, ClassLoader loader) {
        try {
            Class<?> provider = Class.forName(providerClass, false, loader);
            MethodHandle query = MethodHandles.publicLookup().findStatic(provider,
                    "areShadowsCurrentlyBeingRendered", MethodType.methodType(boolean.class));
            return new IrisShadowPass(query);
        } catch (ReflectiveOperationException | LinkageError | SecurityException unavailable) {
            return new IrisShadowPass(null);
        }
    }

    @SuppressWarnings("removal") // Preserve JVM termination even on runtimes retaining ThreadDeath.
    boolean active() {
        MethodHandle current = query;
        if (current == null) return false;
        try {
            return (boolean) current.invokeExact();
        } catch (Throwable unavailable) {
            if (unavailable instanceof VirtualMachineError fatal) throw fatal;
            if (unavailable instanceof ThreadDeath fatal) throw fatal;
            // A broken or changed provider must not cause an exception on every rendered cape.
            query = null;
            return false;
        }
    }
}
