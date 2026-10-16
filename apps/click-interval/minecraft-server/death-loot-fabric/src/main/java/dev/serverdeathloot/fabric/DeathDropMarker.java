package dev.serverdeathloot.fabric;

public interface DeathDropMarker {
    void serverDeathLoot$setExpiry(long expiresAtMillis);

    long serverDeathLoot$expiresAtMillis();
}
