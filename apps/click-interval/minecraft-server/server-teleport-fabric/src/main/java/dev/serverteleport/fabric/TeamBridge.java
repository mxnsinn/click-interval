package dev.serverteleport.fabric;

import java.util.UUID;

/** Missing/failing optional integration never grants consent or exemptions. */
final class TeamBridge {
    private TeamBridge() { }
    static boolean trusts(UUID recipient, UUID requester) { return query("trusts", recipient, requester); }
    static boolean friendly(UUID first, UUID second) { return query("isFriendly", first, second); }
    private static boolean query(String method, UUID first, UUID second) {
        try {
            return Boolean.TRUE.equals(Class.forName("dev.serverteams.fabric.TeamApi")
                    .getMethod(method, UUID.class, UUID.class).invoke(null, first, second));
        } catch (ReflectiveOperationException | LinkageError error) { return false; }
    }
}
