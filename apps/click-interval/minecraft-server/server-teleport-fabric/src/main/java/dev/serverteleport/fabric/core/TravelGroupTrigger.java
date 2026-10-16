package dev.serverteleport.fabric.core;

/** Every player-facing teleport route that automatically carries the player's safe travel group. */
public enum TravelGroupTrigger {
    PLAYER_REQUEST(false),
    RANDOM(false),
    SAVED_PLACE(true),
    BACK(true);

    private final boolean exactPlayerDestination;

    TravelGroupTrigger(boolean exactPlayerDestination) {
        this.exactPlayerDestination = exactPlayerDestination;
    }

    public boolean automatic() {
        return true;
    }

    /**
     * Saved coordinates are a player promise, not a hint for the landing search. Requests to a
     * moving player can still use vehicle-safe fallbacks, but saved places and backtracking must
     * put the traveler at the recorded position even when there is no supporting floor.
     */
    public boolean exactPlayerDestination() {
        return exactPlayerDestination;
    }
}
