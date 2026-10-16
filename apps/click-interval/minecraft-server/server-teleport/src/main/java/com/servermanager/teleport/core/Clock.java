package com.servermanager.teleport.core;

@FunctionalInterface
public interface Clock {
    long nowMillis();

    Clock SYSTEM = System::currentTimeMillis;
}
