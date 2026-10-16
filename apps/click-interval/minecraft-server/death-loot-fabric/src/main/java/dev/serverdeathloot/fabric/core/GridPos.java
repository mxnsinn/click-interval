package dev.serverdeathloot.fabric.core;

public record GridPos(int x, int y, int z) {
    public GridPos offset(int dx, int dy, int dz) {
        return new GridPos(x + dx, y + dy, z + dz);
    }
}
