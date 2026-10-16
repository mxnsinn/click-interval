package dev.serverdeathloot.fabric.core;

public enum HorizontalStep {
    EAST(1, 0),
    SOUTH(0, 1),
    WEST(-1, 0),
    NORTH(0, -1);

    private final int dx;
    private final int dz;

    HorizontalStep(int dx, int dz) {
        this.dx = dx;
        this.dz = dz;
    }

    public int dx() {
        return dx;
    }

    public int dz() {
        return dz;
    }
}
