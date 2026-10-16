package dev.serverdeathloot.fabric.core;

import java.util.Optional;

public record ChestPlacementPlan(GridPos first, GridPos second, HorizontalStep connection) {
    public ChestPlacementPlan {
        if (first == null) throw new IllegalArgumentException("first position is required");
        if ((second == null) != (connection == null)) {
            throw new IllegalArgumentException("second position and connection must both be present or absent");
        }
    }

    public static ChestPlacementPlan single(GridPos position) {
        return new ChestPlacementPlan(position, null, null);
    }

    public static ChestPlacementPlan pair(GridPos first, GridPos second, HorizontalStep connection) {
        return new ChestPlacementPlan(first, second, connection);
    }

    public boolean isDouble() {
        return second != null;
    }

    public Optional<GridPos> secondPosition() {
        return Optional.ofNullable(second);
    }
}
