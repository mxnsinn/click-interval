package dev.serverteleport.fabric.core;

/** Exact horizontal chunks occupied by an entity; no floor/height assumption is made. */
public record ChunkFootprint(int minX, int minZ, int maxX, int maxZ) {
    public ChunkFootprint {
        if (maxX < minX || maxZ < minZ || (long) maxX - minX > 8 || (long) maxZ - minZ > 8) {
            throw new IllegalArgumentException("invalid or excessive arrival footprint");
        }
    }

    public static ChunkFootprint ofBounds(double minX, double minZ, double maxX, double maxZ) {
        if (!Double.isFinite(minX) || !Double.isFinite(minZ)
                || !Double.isFinite(maxX) || !Double.isFinite(maxZ)
                || maxX <= minX || maxZ <= minZ) throw new IllegalArgumentException("invalid bounds");
        return new ChunkFootprint(((int) Math.floor(minX)) >> 4, ((int) Math.floor(minZ)) >> 4,
                ((int) Math.floor(Math.nextDown(maxX))) >> 4, ((int) Math.floor(Math.nextDown(maxZ))) >> 4);
    }
}
