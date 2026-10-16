package dev.serverprotection.fabric;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/** Optional, once-resolved integration with the server's bounded enchantment harvester. */
final class AutomaticHarvestGuard {
    private final Method check;
    private AutomaticHarvestGuard(Method check) { this.check = check; }
    static AutomaticHarvestGuard absent() { return new AutomaticHarvestGuard(null); }
    static AutomaticHarvestGuard load(boolean installed, ClassLoader loader, Class<?> playerType)
            throws ReflectiveOperationException {
        if (!installed) return absent();
        return fromProvider(Class.forName("dev.serverenchantments.fabric.ServerEnchantmentsFabric", true, loader), playerType);
    }
    static AutomaticHarvestGuard fromProvider(Class<?> provider, Class<?> playerType)
            throws ReflectiveOperationException {
        Method method = provider.getMethod("isAutomaticBreak", playerType);
        if (method.getReturnType() != boolean.class || !Modifier.isStatic(method.getModifiers()))
            throw new NoSuchMethodException("automatic break guard must be static boolean");
        return new AutomaticHarvestGuard(method);
    }
    boolean isAutomaticBreak(Object player) {
        if (check == null || player == null) return false;
        try { return Boolean.TRUE.equals(check.invoke(null, player)); }
        catch (ReflectiveOperationException | RuntimeException | LinkageError ignored) { return false; }
    }
}
