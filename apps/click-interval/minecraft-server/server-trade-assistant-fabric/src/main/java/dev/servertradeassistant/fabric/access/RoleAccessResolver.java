package dev.servertradeassistant.fabric.access;

import org.slf4j.Logger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Reloads access.yml on demand without parsing it on every button click. */
public final class RoleAccessResolver {
    private static final long CHECK_INTERVAL_NANOS = 250_000_000L;

    private final Path accessFile;
    private final Logger logger;
    private RoleAccessPolicy policy = RoleAccessPolicy.empty();
    private long lastCheckNanos;
    private long lastModified = Long.MIN_VALUE;
    private long lastSize = Long.MIN_VALUE;
    private String lastFailure = "";

    public RoleAccessResolver(Path accessFile, Logger logger) {
        this.accessFile = accessFile;
        this.logger = logger;
    }

    public RoleAccessPolicy.Decision decide(String playerName, UUID playerId,
            boolean requirePermission, int defaultDiscount) {
        reloadIfChanged();
        return policy.decide(playerName, playerId, requirePermission, defaultDiscount);
    }

    public boolean hasCapability(String playerName, UUID playerId, String capability) {
        reloadIfChanged();
        return policy.hasCapability(playerName, playerId, capability);
    }

    private void reloadIfChanged() {
        long now = System.nanoTime();
        if (now - lastCheckNanos < CHECK_INTERVAL_NANOS) return;
        lastCheckNanos = now;
        try {
            long modified = Files.isRegularFile(accessFile)
                    ? Files.getLastModifiedTime(accessFile).toMillis() : -1L;
            long size = Files.isRegularFile(accessFile) ? Files.size(accessFile) : -1L;
            if (modified == lastModified && size == lastSize) return;
            RoleAccessPolicy updated = RoleAccessPolicy.read(accessFile);
            policy = updated;
            lastModified = modified;
            lastSize = size;
            lastFailure = "";
        } catch (IOException error) {
            String message = String.valueOf(error.getMessage());
            if (!message.equals(lastFailure)) {
                logger.warn("Trade Assistant rejected access.yml; keeping the last valid policy: {}", message);
                lastFailure = message;
            }
        }
    }
}
