package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ReturnLocationBookTest {
    @Test
    void replacesAPlayersPreviousLocationAndSupportsSwapSemantics() {
        ReturnLocationBook book = new ReturnLocationBook(4);
        UUID player = UUID.randomUUID();
        ReturnPoint first = point(1.0);
        ReturnPoint second = point(2.0);

        book.put(player, first);
        assertEquals(first, book.find(player).orElseThrow());

        book.put(player, second);
        assertEquals(second, book.find(player).orElseThrow());
        assertEquals(1, book.size());
    }

    @Test
    void evictsTheOldestPlayerAtTheHardLimit() {
        ReturnLocationBook book = new ReturnLocationBook(2);
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID third = UUID.randomUUID();

        book.put(first, point(1.0));
        book.put(second, point(2.0));
        book.put(third, point(3.0));

        assertFalse(book.find(first).isPresent());
        assertTrue(book.find(second).isPresent());
        assertTrue(book.find(third).isPresent());
        assertEquals(2, book.size());
    }

    @Test
    void removalAndClearDiscardSessionState() {
        ReturnLocationBook book = new ReturnLocationBook(2);
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        book.put(first, point(1.0));
        book.put(second, point(2.0));

        book.remove(first);
        assertFalse(book.find(first).isPresent());
        book.clear();
        assertEquals(0, book.size());
    }

    @Test
    void rejectsUnboundedCapacities() {
        assertThrows(IllegalArgumentException.class, () -> new ReturnLocationBook(0));
        assertThrows(IllegalArgumentException.class, () -> new ReturnLocationBook(65_537));
    }

    @Test
    void rejectsAPlayerAndVehicleOriginFromDifferentDimensions() {
        SavedLocation player = new SavedLocation(
                "minecraft:overworld", 0.0, 65.5, 0.0, 0.0F, 0.0F);
        SavedLocation root = new SavedLocation(
                "minecraft:the_nether", 0.0, 64.0, 0.0, 0.0F, 0.0F);
        assertThrows(IllegalArgumentException.class,
                () -> new ReturnPoint(player, UUID.randomUUID(), root));
    }

    private static ReturnPoint point(double x) {
        SavedLocation player = new SavedLocation(
                "minecraft:overworld", x, 65.5, 0.0, 0.0F, 0.0F);
        SavedLocation root = new SavedLocation(
                "minecraft:overworld", x, 64.0, 0.0, 90.0F, 0.0F);
        return new ReturnPoint(player, UUID.randomUUID(), root);
    }
}
