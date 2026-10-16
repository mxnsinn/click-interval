package dev.serverteleport.fabric.core;

import java.util.ArrayList;
import java.util.List;

/** Deterministic horizontal landing candidates shared by production and regression tests. */
public final class TravelLandingOffsets {
    private TravelLandingOffsets() {
    }

    public record Offset(double x, double z) {
        public Offset {
            if (!Double.isFinite(x) || !Double.isFinite(z)) {
                throw new IllegalArgumentException("landing offset must be finite");
            }
        }
    }

    public record Position(double x, double y, double z) {
        public Position {
            if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
                throw new IllegalArgumentException("landing position must be finite");
            }
        }
    }

    /**
     * Moves a vehicle root by exactly the same delta needed to put its passenger at the recorded
     * player destination. Keeping the vehicle's current rotation preserves its seat geometry.
     */
    public static Position exactRootDestination(
            double destinationX,
            double destinationY,
            double destinationZ,
            double rootX,
            double rootY,
            double rootZ,
            double travelerX,
            double travelerY,
            double travelerZ) {
        return new Position(
                destinationX + rootX - travelerX,
                destinationY + rootY - travelerY,
                destinationZ + rootZ - travelerZ);
    }

    public static List<Offset> candidates(
            boolean primary,
            boolean carriesVehicleOrPassengers,
            boolean exactPrimaryDestination,
            double preferredX,
            double preferredZ,
            double spacing,
            int radius) {
        if (!Double.isFinite(preferredX) || !Double.isFinite(preferredZ)
                || !Double.isFinite(spacing) || spacing <= 0.0 || radius < 0) {
            throw new IllegalArgumentException("invalid landing search bounds");
        }

        ArrayList<Offset> offsets = new ArrayList<>();
        offsets.add(primary ? new Offset(0.0, 0.0) : new Offset(preferredX, preferredZ));
        if (primary && (exactPrimaryDestination || !carriesVehicleOrPassengers)) {
            return List.copyOf(offsets);
        }

        for (int ring = 1; ring <= radius; ring++) {
            for (int x = -ring; x <= ring; x++) {
                for (int z = -ring; z <= ring; z++) {
                    if (Math.abs(x) != ring && Math.abs(z) != ring) continue;
                    offsets.add(new Offset(x * spacing, z * spacing));
                }
            }
        }
        return List.copyOf(offsets);
    }

    public static List<Integer> verticalOffsets(
            boolean primary,
            boolean carriesVehicleOrPassengers,
            boolean exactPrimaryDestination) {
        if (primary && (exactPrimaryDestination || !carriesVehicleOrPassengers)) {
            return List.of(0);
        }
        return List.of(0, 1, -1, 2, -2);
    }
}
