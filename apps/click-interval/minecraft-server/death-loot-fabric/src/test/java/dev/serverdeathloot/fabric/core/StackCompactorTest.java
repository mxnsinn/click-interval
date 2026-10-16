package dev.serverdeathloot.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.ArrayList;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class StackCompactorTest {
    @Test
    void compatiblePilesMergeWithoutLosingCount() {
        List<Pile> result = compact(List.of(
                new Pile("stone", 30, 64),
                new Pile("stone", 40, 64)));

        assertEquals(List.of(new Pile("stone", 64, 64), new Pile("stone", 6, 64)), result);
        assertEquals(70, result.stream().mapToInt(Pile::count).sum());
    }

    @Test
    void unlikeItemsNeverMerge() {
        List<Pile> result = compact(List.of(
                new Pile("stone", 32, 64),
                new Pile("dirt", 32, 64)));
        assertEquals(2, result.size());
        assertEquals("stone", result.get(0).key());
        assertEquals("dirt", result.get(1).key());
    }

    @Test
    void unstackableItemsRemainSeparate() {
        List<Pile> result = compact(List.of(
                new Pile("sword", 1, 1),
                new Pile("sword", 1, 1)));
        assertEquals(2, result.size());
    }

    @Test
    void oversizedInputSplitsAtMaximum() {
        List<Pile> result = compact(List.of(new Pile("stone", 130, 64)));
        assertEquals(List.of(
                new Pile("stone", 64, 64),
                new Pile("stone", 64, 64),
                new Pile("stone", 2, 64)), result);
    }

    @Test
    void resultUsesCopiesAndDoesNotMutateInput() {
        Pile source = new Pile("stone", 20, 64);
        List<Pile> result = compact(List.of(source));
        assertNotSame(source, result.getFirst());
        assertEquals(20, source.count());
    }

    @Test
    void nullArgumentsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> StackCompactor.compact(
                null, Pile::count, Pile::maximum, Pile::compatible, Pile::copy, Pile::setCount));
    }

    @Test
    void deterministicFuzzCasesConserveEveryItemCount() {
        Random random = new Random(0x5EEDC0DEL);
        for (int run = 0; run < 500; run++) {
            List<Pile> input = new ArrayList<>();
            int[] expectedByKey = new int[8];
            int entries = 1 + random.nextInt(80);
            for (int index = 0; index < entries; index++) {
                int key = random.nextInt(expectedByKey.length);
                int count = 1 + random.nextInt(130);
                input.add(new Pile("item-" + key, count, 64));
                expectedByKey[key] += count;
            }

            List<Pile> output = compact(input);
            int[] actualByKey = new int[expectedByKey.length];
            for (Pile pile : output) {
                actualByKey[Integer.parseInt(pile.key().substring(5))] += pile.count();
                assertEquals(64, pile.maximum());
                org.junit.jupiter.api.Assertions.assertTrue(pile.count() >= 1 && pile.count() <= 64);
            }
            org.junit.jupiter.api.Assertions.assertArrayEquals(expectedByKey, actualByKey);
        }
    }

    private static List<Pile> compact(List<Pile> piles) {
        return StackCompactor.compact(
                piles,
                Pile::count,
                Pile::maximum,
                Pile::compatible,
                Pile::copy,
                Pile::setCount);
    }

    private static final class Pile {
        private final String key;
        private int count;
        private final int maximum;

        private Pile(String key, int count, int maximum) {
            this.key = key;
            this.count = count;
            this.maximum = maximum;
        }

        private String key() { return key; }
        private int count() { return count; }
        private int maximum() { return maximum; }
        private void setCount(int value) { count = value; }
        private Pile copy() { return new Pile(key, count, maximum); }
        private boolean compatible(Pile other) { return key.equals(other.key); }

        @Override
        public boolean equals(Object value) {
            return value instanceof Pile other
                    && key.equals(other.key)
                    && count == other.count
                    && maximum == other.maximum;
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(key, count, maximum);
        }

        @Override
        public String toString() {
            return key + ':' + count + '/' + maximum;
        }
    }
}
