package com.clickinterval.anticheat.core;

@FunctionalInterface
public interface Clock {
    long nowMillis();

    Clock SYSTEM = System::currentTimeMillis;
}
