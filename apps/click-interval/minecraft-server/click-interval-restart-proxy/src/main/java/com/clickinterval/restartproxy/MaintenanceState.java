package com.clickinterval.restartproxy;

import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

final class MaintenanceState {
  enum Phase {
    ACTIVE,
    DRAINING,
    ARMED,
    RESTORING
  }

  record ArmResult(boolean changed, long generation, Phase phase) {}

  record RestorePlan(boolean accepted, long generation, Phase phase, Set<UUID> players) {}

  record Snapshot(Phase phase, long generation, String message, Set<UUID> players) {}

  private Phase phase = Phase.ACTIVE;
  private long generation;
  private String message = "";
  private final Set<UUID> managedPlayers = new LinkedHashSet<>();

  synchronized ArmResult arm(String newMessage) {
    Objects.requireNonNull(newMessage, "newMessage");
    if (this.phase != Phase.ACTIVE) {
      return new ArmResult(false, this.generation, this.phase);
    }

    this.phase = Phase.DRAINING;
    this.generation++;
    this.message = newMessage;
    this.managedPlayers.clear();
    return new ArmResult(true, this.generation, this.phase);
  }

  synchronized boolean track(UUID playerId) {
    Objects.requireNonNull(playerId, "playerId");
    if (this.phase != Phase.DRAINING && this.phase != Phase.ARMED) {
      return false;
    }
    this.managedPlayers.add(playerId);
    return true;
  }

  synchronized boolean finishDrain(long expectedGeneration, boolean routingQuiescent) {
    if (this.phase != Phase.DRAINING
        || this.generation != expectedGeneration
        || !routingQuiescent) {
      return false;
    }
    this.phase = Phase.ARMED;
    return true;
  }

  synchronized RestorePlan beginRestore() {
    if (this.phase != Phase.ARMED) {
      return new RestorePlan(false, this.generation, this.phase, Set.of());
    }

    this.phase = Phase.RESTORING;
    return new RestorePlan(
        true,
        this.generation,
        this.phase,
        Set.copyOf(this.managedPlayers));
  }

  synchronized RestorePlan beginRollback() {
    if (this.phase != Phase.DRAINING) {
      return new RestorePlan(false, this.generation, this.phase, Set.of());
    }

    this.phase = Phase.RESTORING;
    return new RestorePlan(
        true,
        this.generation,
        this.phase,
        Set.copyOf(this.managedPlayers));
  }

  synchronized boolean untrack(UUID playerId) {
    Objects.requireNonNull(playerId, "playerId");
    this.managedPlayers.remove(playerId);
    return this.phase == Phase.RESTORING && this.managedPlayers.isEmpty();
  }

  synchronized boolean completeRestoreIfEmpty() {
    if (this.phase != Phase.RESTORING || !this.managedPlayers.isEmpty()) {
      return false;
    }

    this.phase = Phase.ACTIVE;
    this.message = "";
    return true;
  }

  synchronized boolean markRestoreIncomplete() {
    if (this.phase != Phase.RESTORING || this.managedPlayers.isEmpty()) {
      return false;
    }
    this.phase = Phase.ARMED;
    return true;
  }

  synchronized boolean abortToActive() {
    if (this.phase != Phase.RESTORING) {
      return false;
    }
    this.phase = Phase.ACTIVE;
    this.message = "";
    this.managedPlayers.clear();
    return true;
  }

  synchronized Snapshot snapshot() {
    return new Snapshot(
        this.phase,
        this.generation,
        this.message,
        Set.copyOf(this.managedPlayers));
  }
}
