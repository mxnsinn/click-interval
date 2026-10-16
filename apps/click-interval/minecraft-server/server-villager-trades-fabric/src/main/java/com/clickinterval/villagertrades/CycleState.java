package com.clickinterval.villagertrades;

/** Cooldown is attached to the villager, not to a reopenable screen or a player session. */
public interface CycleState {
    boolean clickInterval$acquireCycle(long gameTime);
}
