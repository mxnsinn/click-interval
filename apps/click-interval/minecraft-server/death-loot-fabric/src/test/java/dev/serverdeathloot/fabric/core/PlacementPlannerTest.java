package dev.serverdeathloot.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlacementPlannerTest {
    @Test
    void deathBlockIsFirstCandidate() {
        GridPos death = new GridPos(20, 70, -4);
        assertEquals(death, PlacementPlanner.candidates(death).getFirst());
    }

    @Test
    void candidatesStayWithinBoundedSearchVolume() {
        GridPos center = new GridPos(0, 0, 0);
        for (GridPos candidate : PlacementPlanner.candidates(center)) {
            int horizontalDistance = Math.abs(candidate.x()) + Math.abs(candidate.z());
            assertTrue(horizontalDistance <= PlacementPlanner.SEARCH_RADIUS);
            assertTrue(Math.abs(candidate.y()) <= 3);
        }
    }

    @Test
    void candidatesAreUnique() {
        List<GridPos> candidates = PlacementPlanner.candidates(new GridPos(1, 2, 3));
        assertEquals(candidates.size(), new HashSet<>(candidates).size());
    }

    @Test
    void singleChestUsesFirstEligiblePosition() {
        GridPos center = new GridPos(5, 64, 5);
        GridPos expected = center.offset(1, 0, 0);
        ChestPlacementPlan plan = PlacementPlanner.find(center, false, expected::equals).orElseThrow();

        assertEquals(expected, plan.first());
        assertFalse(plan.isDouble());
    }

    @Test
    void doubleChestRequiresTwoAdjacentEligiblePositions() {
        GridPos center = new GridPos(5, 64, 5);
        Set<GridPos> free = Set.of(center, center.offset(0, 0, 1));
        ChestPlacementPlan plan = PlacementPlanner.find(center, true, free::contains).orElseThrow();

        assertTrue(plan.isDouble());
        assertEquals(center, plan.first());
        assertEquals(center.offset(0, 0, 1), plan.second());
        assertEquals(HorizontalStep.SOUTH, plan.connection());
    }

    @Test
    void noEligibleSpaceReturnsEmpty() {
        assertTrue(PlacementPlanner.find(new GridPos(0, 64, 0), false, ignored -> false).isEmpty());
        assertTrue(PlacementPlanner.find(new GridPos(0, 64, 0), true, ignored -> false).isEmpty());
    }
}
