package com.clickinterval.villagertrades;

/** One process-wide receiver, including when several integrated worlds are opened successively. */
public final class NetworkInitialization {
    private boolean registered;
    public static boolean clientOwnsCodecs(boolean clientProcess, boolean buttonPresent) {
        return clientProcess && buttonPresent;
    }
    public synchronized void once(Runnable registration) {
        if (registered) return;
        registration.run();
        registered = true;
    }
}
