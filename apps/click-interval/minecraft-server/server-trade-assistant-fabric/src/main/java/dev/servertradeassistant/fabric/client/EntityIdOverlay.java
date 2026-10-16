package dev.servertradeassistant.fabric.client;

/** Client-local display state. Permission always comes from the current server. */
public final class EntityIdOverlay {
    public static final double MAX_DISTANCE_SQUARED = 48.0D * 48.0D;

    private static volatile boolean allowed;
    private static volatile boolean requested;

    private EntityIdOverlay() { }

    public static boolean visible() {
        return allowed && requested;
    }

    public static boolean allowed() {
        return allowed;
    }

    public static boolean requested() {
        return requested;
    }

    public static void setRequested(boolean show) {
        requested = show && allowed;
    }

    public static void setAllowed(boolean permitted) {
        allowed = permitted;
        if (!permitted) requested = false;
    }

    public static void reset() {
        allowed = false;
        requested = false;
    }
}
