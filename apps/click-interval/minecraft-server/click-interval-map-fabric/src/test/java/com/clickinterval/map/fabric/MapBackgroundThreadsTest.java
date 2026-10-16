package com.clickinterval.map.fabric;

import org.junit.jupiter.api.Test;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class MapBackgroundThreadsTest {
    @Test
    void elevatedCreatorPriorityIsNotInheritedByMapWorkers() throws Exception {
        var result = new AtomicReference<Thread>();
        Thread creator = new Thread(() -> result.set(MapBackgroundThreads.create(() -> {}, "map-test")));
        creator.setPriority(Thread.MAX_PRIORITY);
        creator.start();
        creator.join(2_000L);
        assertFalse(creator.isAlive());
        assertNotNull(result.get());
        assertEquals(Thread.NORM_PRIORITY - 1, result.get().getPriority());
        assertTrue(result.get().isDaemon());
        assertEquals("map-test", result.get().getName());
    }
}
