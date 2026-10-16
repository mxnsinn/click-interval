package dev.serverteleport.fabric.core;

import java.util.Objects;

/** Opaque, single-use handle for one reserved TPA acceptance. */
public record AcceptanceReservation(long id, TeleportRequest request) {
    public AcceptanceReservation {
        if (id <= 0L) throw new IllegalArgumentException("reservation id must be positive");
        Objects.requireNonNull(request, "request");
    }
}
