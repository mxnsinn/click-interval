package dev.proximityvoice.core;

public record RelayStatus(
        String state,
        int protocolVersion,
        String bindAddress,
        String publicHost,
        int port,
        double voiceRadius,
        int sessions,
        long associatedClients,
        RelayMetrics.Snapshot metrics,
        String lastError,
        String updatedAt
) {
    public RelayStatus {
        state = clean(state, 24);
        bindAddress = clean(bindAddress, 253);
        publicHost = clean(publicHost, 253);
        lastError = clean(lastError, 512);
        updatedAt = clean(updatedAt, 48);
        if (metrics == null) metrics = new RelayMetrics().snapshot();
    }

    private static String clean(String value, int maximum) {
        String text = String.valueOf(value == null ? "" : value)
                .replaceAll("[\\p{Cntrl}]", " ").trim();
        return text.substring(0, Math.min(maximum, text.length()));
    }
}
