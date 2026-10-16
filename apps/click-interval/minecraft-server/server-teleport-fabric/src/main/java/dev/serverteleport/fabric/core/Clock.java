package dev.serverteleport.fabric.core;

@FunctionalInterface
public interface Clock {
    Clock SYSTEM = System::currentTimeMillis;

    long nowMillis();
}
