package com.clickinterval.restartproxy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class MaintenanceStateTest {
  @Test
  void completeCycleRequiresEveryManagedPlayerToLeaveRestoring() {
    MaintenanceState state = new MaintenanceState();
    UUID first = UUID.randomUUID();
    UUID second = UUID.randomUUID();

    assertTrue(state.arm("Updating").changed());
    assertTrue(state.finishDrain(1L, true));
    assertTrue(state.track(first));
    assertTrue(state.track(second));

    MaintenanceState.RestorePlan plan = state.beginRestore();
    assertTrue(plan.accepted());
    assertEquals(2, plan.players().size());
    assertFalse(state.untrack(first));
    assertTrue(state.untrack(second));
    assertTrue(state.completeRestoreIfEmpty());
    assertEquals(MaintenanceState.Phase.ACTIVE, state.snapshot().phase());
  }

  @Test
  void incompleteRestoreReturnsToArmedWithoutLosingPlayers() {
    MaintenanceState state = new MaintenanceState();
    UUID player = UUID.randomUUID();

    state.arm("Updating");
    state.finishDrain(1L, true);
    state.track(player);
    state.beginRestore();

    assertTrue(state.markRestoreIncomplete());
    assertEquals(MaintenanceState.Phase.ARMED, state.snapshot().phase());
    assertEquals(Set.of(player), state.snapshot().players());
  }

  @Test
  void armIsIdempotentlyRejectedOutsideActiveState() {
    MaintenanceState state = new MaintenanceState();

    MaintenanceState.ArmResult first = state.arm("One");
    MaintenanceState.ArmResult duplicate = state.arm("Two");

    assertTrue(first.changed());
    assertFalse(duplicate.changed());
    assertEquals(1L, duplicate.generation());
    assertEquals("One", state.snapshot().message());
  }

  @Test
  void drainMustFinishBeforeReadyCanBegin() {
    MaintenanceState state = new MaintenanceState();
    state.arm("Updating");

    assertEquals(MaintenanceState.Phase.DRAINING, state.snapshot().phase());
    assertFalse(state.beginRestore().accepted());
    assertFalse(state.finishDrain(1L, false));
    assertEquals(MaintenanceState.Phase.DRAINING, state.snapshot().phase());
    assertTrue(state.finishDrain(1L, true));
    assertTrue(state.beginRestore().accepted());
  }

  @Test
  void failedDrainCanRollbackAndDisarm() {
    MaintenanceState state = new MaintenanceState();
    UUID player = UUID.randomUUID();
    state.arm("Updating");
    state.track(player);

    assertTrue(state.beginRollback().accepted());
    assertTrue(state.abortToActive());
    assertEquals(MaintenanceState.Phase.ACTIVE, state.snapshot().phase());
    assertTrue(state.snapshot().players().isEmpty());
  }
}
