package dev.serverteleport.fabric;

import dev.serverteleport.fabric.core.RequestBook;
import dev.serverteleport.fabric.core.ReturnLocationBook;
import dev.serverteleport.fabric.core.ReturnLockStore;
import dev.serverteleport.fabric.core.ReturnPoint;
import dev.serverteleport.fabric.core.SavedLocation;
import dev.serverteleport.fabric.core.SavedLocationStore;
import dev.serverteleport.fabric.core.TeleportWarmupState;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Exercises the real adapter's life reset without a running Minecraft world or fake damage. */
final class TeleportDeathResetTest {
    @TempDir Path temporary;

    @Test void deathBeforeTeleportClearsOldCombatAndCooldownButPreservesSavedAndBackLocations() throws Exception {
        ServerTeleportFabric mod = new ServerTeleportFabric();
        UUID player = UUID.randomUUID(), attacker = UUID.randomUUID();
        Map<UUID, Long> combat = field(mod, "recentPvpUntil");
        combat.put(player, System.currentTimeMillis() + 15_000);
        combat.put(attacker, System.currentTimeMillis() + 15_000);
        RequestBook requests = field(mod, "requests");
        requests.startLocalTravelCooldown(player, false);
        SavedLocation place = new SavedLocation("minecraft:overworld", 5, 70, 8, 90, 0);
        SavedLocationStore places = SavedLocationStore.open(temporary.resolve("places.tsv"));
        places.put(player, "home", place);
        Field placesField = ServerTeleportFabric.class.getDeclaredField("locations");
        placesField.setAccessible(true);
        placesField.set(mod, places);
        ReturnLocationBook back = field(mod, "returnLocations");
        ReturnPoint point = new ReturnPoint(place, player, place);
        back.put(player, point);
        ReturnLockStore locks = ReturnLockStore.open(temporary.resolve("locks.tsv"));
        locks.arm(player, place, System.currentTimeMillis());
        Field locksField = ServerTeleportFabric.class.getDeclaredField("returnLocks");
        locksField.setAccessible(true);
        locksField.set(mod, locks);

        mod.resetPlayerLife(player);

        assertFalse(combat.containsKey(player));
        assertTrue(combat.containsKey(attacker), "the surviving opponent remains in combat");
        assertEquals(0, requests.remainingCooldownMillis(player, false));
        assertEquals(point, back.find(player).orElseThrow());
        assertEquals(place, places.find(player, "home").orElseThrow());
        assertEquals(place, SavedLocationStore.open(temporary.resolve("places.tsv")).find(player, "home").orElseThrow());
        assertEquals(0, ReturnLockStore.open(temporary.resolve("locks.tsv"))
                .remainingMillis(player, place.dimension(), place.x(), place.z(), System.currentTimeMillis()));

        var mark = ServerTeleportFabric.class.getDeclaredMethod("markRecentPvp", UUID.class, long.class);
        mark.setAccessible(true);
        long newFight = System.currentTimeMillis();
        mark.invoke(mod, player, newFight);
        assertEquals(newFight + 15_000, combat.get(player));
        requests.startLocalTravelCooldown(player, false);
        assertTrue(requests.remainingCooldownMillis(player, false) > 0);
    }

    @Test void deathDuringWarmupCancelsOldQueuedJobAndInvalidatesItsReservationExactlyOnce() throws Exception {
        ServerTeleportFabric mod = new ServerTeleportFabric();
        UUID player = UUID.randomUUID(), target = UUID.randomUUID();
        RequestBook requests = field(mod, "requests");
        requests.create(player, "Alex", target, "Sam", false);
        var reservation = requests.respond(target, "Alex", true).reservation();
        AtomicInteger cancelled = new AtomicInteger();
        Map<UUID, Object> pending = field(mod, "pendingTeleports");
        pending.put(player, queuedWarmup(() -> {
            cancelled.incrementAndGet();
            requests.invalidate(reservation);
        }));

        mod.resetPlayerLife(player);
        mod.resetPlayerLife(player);

        assertFalse(pending.containsKey(player));
        assertEquals(1, cancelled.get());
        assertFalse(requests.isActiveReservation(reservation));
        assertFalse(requests.commit(reservation));
        assertFalse(requests.release(reservation));
        assertEquals(0, requests.remainingCooldownMillis(player, false));
    }

    @Test void targetDeathAlsoCancelsTheIncomingTravelersQueuedJob() throws Exception {
        ServerTeleportFabric mod = new ServerTeleportFabric();
        UUID player = UUID.randomUUID(), target = UUID.randomUUID();
        RequestBook requests = field(mod, "requests");
        requests.create(player, "Alex", target, "Sam", false);
        var reservation = requests.respond(target, "Alex", true).reservation();
        AtomicInteger cancelled = new AtomicInteger();
        Map<UUID, Object> pending = field(mod, "pendingTeleports");
        pending.put(player, queuedWarmup(cancelled::incrementAndGet));

        mod.resetPlayerLife(target);

        assertTrue(pending.isEmpty());
        assertEquals(1, cancelled.get());
        assertFalse(requests.isActiveReservation(reservation));
        assertTrue(requests.remainingCooldownMillis(player, false) > 0);
    }

    private static Object queuedWarmup(Runnable cancel) throws Exception {
        Class<?> actionType = Class.forName(ServerTeleportFabric.class.getName() + "$TeleportAction");
        Object action = Proxy.newProxyInstance(actionType.getClassLoader(), new Class<?>[]{actionType},
                (proxy, method, args) -> { throw new AssertionError("a dead life's action must not run"); });
        Class<?> pendingType = Class.forName(ServerTeleportFabric.class.getName() + "$PendingTeleport");
        var constructor = pendingType.getDeclaredConstructors()[0];
        constructor.setAccessible(true);
        return constructor.newInstance(null,
                new TeleportWarmupState(System.currentTimeMillis(), "minecraft:overworld", 0, 70, 0),
                "minecraft:overworld", System.currentTimeMillis() + 30_000,
                (Supplier<Object>) () -> null, action, cancel, (Runnable) () -> { }, null);
    }

    @SuppressWarnings("unchecked")
    private static <T> T field(ServerTeleportFabric mod, String name) throws Exception {
        Field field = ServerTeleportFabric.class.getDeclaredField(name);
        field.setAccessible(true);
        return (T) field.get(mod);
    }
}
