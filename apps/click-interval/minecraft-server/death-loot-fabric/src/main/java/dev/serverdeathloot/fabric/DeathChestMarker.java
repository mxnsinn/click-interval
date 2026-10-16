package dev.serverdeathloot.fabric;

public interface DeathChestMarker {
    void serverDeathLoot$mark(String deathId, long expiresAtMillis);

    String serverDeathLoot$deathId();

    long serverDeathLoot$expiresAtMillis();

    default boolean serverDeathLoot$isMarked() {
        String deathId = serverDeathLoot$deathId();
        return deathId != null && !deathId.isBlank();
    }
}
