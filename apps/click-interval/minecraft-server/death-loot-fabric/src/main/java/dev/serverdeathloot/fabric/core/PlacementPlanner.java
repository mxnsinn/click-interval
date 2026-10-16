package dev.serverdeathloot.fabric.core;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;

public final class PlacementPlanner {
    public static final int SEARCH_RADIUS = 4;
    private static final int[] VERTICAL_OFFSETS = {0, 1, -1, 2, -2, 3, -3};

    private PlacementPlanner() {}

    public static Optional<ChestPlacementPlan> find(
            GridPos deathPosition,
            boolean doubleChest,
            Predicate<GridPos> canPlace
    ) {
        if (deathPosition == null || canPlace == null) {
            throw new IllegalArgumentException("deathPosition and canPlace are required");
        }
        for (GridPos candidate : candidates(deathPosition)) {
            if (!canPlace.test(candidate)) continue;
            if (!doubleChest) return Optional.of(ChestPlacementPlan.single(candidate));
            for (HorizontalStep direction : HorizontalStep.values()) {
                GridPos neighbor = candidate.offset(direction.dx(), 0, direction.dz());
                if (canPlace.test(neighbor)) {
                    return Optional.of(ChestPlacementPlan.pair(candidate, neighbor, direction));
                }
            }
        }
        return Optional.empty();
    }

    public static List<GridPos> candidates(GridPos center) {
        if (center == null) throw new IllegalArgumentException("center is required");
        List<GridPos> result = new ArrayList<>();
        for (int dy : VERTICAL_OFFSETS) {
            for (int distance = 0; distance <= SEARCH_RADIUS; distance++) {
                for (int dx = -distance; dx <= distance; dx++) {
                    int dzMagnitude = distance - Math.abs(dx);
                    result.add(center.offset(dx, dy, dzMagnitude));
                    if (dzMagnitude != 0) result.add(center.offset(dx, dy, -dzMagnitude));
                }
            }
        }
        return List.copyOf(result);
    }
}
