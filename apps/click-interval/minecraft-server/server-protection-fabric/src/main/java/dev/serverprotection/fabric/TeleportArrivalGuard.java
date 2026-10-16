package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.BehaviorPatternAnalyzer;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/** Exact optional runtime arrival hold; no cached player exemption or grace extension. */
final class TeleportArrivalGuard {
    private final Method check;
    private TeleportArrivalGuard(Method check) { this.check = check; }
    static TeleportArrivalGuard absent() { return new TeleportArrivalGuard(null); }
    static TeleportArrivalGuard load(boolean installed, ClassLoader loader, Class<?> playerType)
            throws ReflectiveOperationException {
        if (!installed) return absent();
        return fromProvider(Class.forName("dev.serverteleport.fabric.ServerTeleportFabric", true, loader), playerType);
    }
    static TeleportArrivalGuard fromProvider(Class<?> provider, Class<?> playerType)
            throws ReflectiveOperationException {
        Method method = provider.getMethod("isAwaitingArrival", playerType);
        if (method.getReturnType() != boolean.class || !Modifier.isStatic(method.getModifiers()))
            throw new NoSuchMethodException("arrival guard must be static boolean");
        return new TeleportArrivalGuard(method);
    }
    boolean isAwaiting(Object player) {
        if (check == null || player == null) return false;
        try { return Boolean.TRUE.equals(check.invoke(null, player)); }
        catch (ReflectiveOperationException | RuntimeException | LinkageError ignored) { return false; }
    }
    boolean resetMovementIfAwaiting(Object player, MovementAnalyzer movement, BehaviorPatternAnalyzer behavior) {
        if (!isAwaiting(player)) return false;
        movement.reset();
        behavior.resetMovement();
        // Public timer input exposes a narrow packet reset without clearing combat/mining data.
        behavior.observeMovementPacket(0L, 21, 2, true);
        return true;
    }
}
