package dev.serverdeathloot.fabric.core;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BiPredicate;
import java.util.function.Function;
import java.util.function.ObjIntConsumer;
import java.util.function.ToIntFunction;

public final class StackCompactor {
    private StackCompactor() {}

    public static <T> List<T> compact(
            List<T> input,
            ToIntFunction<T> count,
            ToIntFunction<T> maximum,
            BiPredicate<T, T> compatible,
            Function<T, T> copy,
            ObjIntConsumer<T> setCount
    ) {
        if (input == null || count == null || maximum == null || compatible == null
                || copy == null || setCount == null) {
            throw new IllegalArgumentException("compaction inputs are required");
        }
        List<T> result = new ArrayList<>();
        for (T source : input) {
            if (source == null) continue;
            int remaining = count.applyAsInt(source);
            int sourceMaximum = maximum.applyAsInt(source);
            if (remaining <= 0 || sourceMaximum <= 0) continue;
            for (T target : result) {
                if (remaining == 0) break;
                if (!compatible.test(target, source)) continue;
                int targetCount = count.applyAsInt(target);
                int targetMaximum = maximum.applyAsInt(target);
                int available = Math.max(0, targetMaximum - targetCount);
                int moved = Math.min(remaining, available);
                if (moved > 0) {
                    setCount.accept(target, targetCount + moved);
                    remaining -= moved;
                }
            }
            while (remaining > 0) {
                T next = copy.apply(source);
                int moved = Math.min(remaining, sourceMaximum);
                setCount.accept(next, moved);
                result.add(next);
                remaining -= moved;
            }
        }
        return result;
    }
}
