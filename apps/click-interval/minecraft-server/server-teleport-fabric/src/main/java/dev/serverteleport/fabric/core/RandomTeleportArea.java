package dev.serverteleport.fabric.core;

import java.util.Optional;
import java.util.random.RandomGenerator;

/** Uniform columns throughout the actual border, with room for a broad landing platform. */
public record RandomTeleportArea(int minX, int maxX, int minZ, int maxZ) {
    private static final int WORLD_LIMIT = 29_999_983;

    public static Optional<RandomTeleportArea> withinBorder(
            double borderMinX, double borderMaxX, double borderMinZ, double borderMaxZ) {
        if (!Double.isFinite(borderMinX) || !Double.isFinite(borderMaxX)
                || !Double.isFinite(borderMinZ) || !Double.isFinite(borderMaxZ)) return Optional.empty();
        int minX = (int) Math.ceil(Math.max(-WORLD_LIMIT, borderMinX + 2));
        int maxX = (int) Math.floor(Math.min(WORLD_LIMIT, borderMaxX - 3));
        int minZ = (int) Math.ceil(Math.max(-WORLD_LIMIT, borderMinZ + 2));
        int maxZ = (int) Math.floor(Math.min(WORLD_LIMIT, borderMaxZ - 3));
        if (minX > maxX || minZ > maxZ) return Optional.empty();
        return Optional.of(new RandomTeleportArea(minX, maxX, minZ, maxZ));
    }

    public boolean contains(int x, int z) {
        return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
    }

    /** No unbounded rejection loop, even with invalid or extreme border configurations. */
    public Optional<Column> sample(RandomGenerator random) {
        return Optional.of(new Column(random.nextInt(minX, maxX + 1), random.nextInt(minZ, maxZ + 1)));
    }

    public record Column(int x, int z) { }

    /** Bounded rejection sampling with enough inset for the 9x9 landing scan. */
    public Optional<Column> sampleNearSpawn(RandomGenerator random, int spawnX, int spawnZ, int configuredRadius) {
        double radius = Math.min(10_000, configuredRadius) - 7;
        if (radius <= 0) return Optional.empty();
        for (int i = 0; i < 128; i++) {
            Column candidate = sample(random).orElseThrow();
            if (Math.hypot((double) candidate.x() - spawnX, (double) candidate.z() - spawnZ) <= radius)
                return Optional.of(candidate);
        }
        return Optional.empty();
    }
}
