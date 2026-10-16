package com.clickinterval.map.fabric;

/** Background map work must not inherit the server tick thread's elevated scheduling priority. */
final class MapBackgroundThreads {
    private MapBackgroundThreads() {}

    static Thread create(Runnable task, String name) {
        Thread thread = new Thread(task, name);
        thread.setDaemon(true);
        thread.setPriority(Thread.NORM_PRIORITY - 1);
        return thread;
    }
}
