package dev.servertradeassistant.fabric.control;

import org.junit.jupiter.api.Test;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class AppControlBridgeAsyncSnapshotTest {
    @Test
    void snapshotWorkNeverRunsInlineAndCoalescesToTheNewestValue() {
        ArrayDeque<Runnable> queued = new ArrayDeque<>();
        List<String> written = new ArrayList<>();
        AppControlBridge.LatestAsyncTask<String> writer =
                new AppControlBridge.LatestAsyncTask<>(queued::addLast, written::add);

        writer.submit("old");
        writer.submit("new");

        assertTrue(writer.busy());
        assertEquals(1, queued.size());
        assertTrue(written.isEmpty(), "snapshot work must not execute on the server caller thread");

        queued.removeFirst().run();

        assertEquals(List.of("new"), written);
        assertFalse(writer.busy());
        assertTrue(queued.isEmpty());
    }

    @Test
    void submissionDuringDrainIsNotLost() {
        ArrayDeque<Runnable> queued = new ArrayDeque<>();
        List<String> written = new ArrayList<>();
        @SuppressWarnings("unchecked")
        AppControlBridge.LatestAsyncTask<String>[] holder = new AppControlBridge.LatestAsyncTask[1];
        holder[0] = new AppControlBridge.LatestAsyncTask<>(queued::addLast, value -> {
            written.add(value);
            if (value.equals("first")) holder[0].submit("second");
        });

        holder[0].submit("first");
        queued.removeFirst().run();

        assertEquals(List.of("first", "second"), written);
        assertFalse(holder[0].busy());
        assertTrue(queued.isEmpty());
    }
}
