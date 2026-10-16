package dev.proximityvoice.plugin;

/** Pure lifecycle-state rules kept separate so failure reporting is directly testable. */
public final class RelayLifecycle {
    private RelayLifecycle() {}

    public static String currentState(
            boolean configLoaded,
            boolean configEnabled,
            boolean relayRunning,
            String startupError,
            String relayError
    ) {
        if (configLoaded && !configEnabled) return "disabled";
        if (relayRunning) return "running";
        if (hasError(startupError) || hasError(relayError)) return "error";
        return "stopped";
    }

    public static String stateAfterDisable(String startupError, String relayError) {
        return hasError(startupError) || hasError(relayError) ? "error" : "stopped";
    }

    private static boolean hasError(String value) {
        return value != null && !value.isBlank();
    }
}
