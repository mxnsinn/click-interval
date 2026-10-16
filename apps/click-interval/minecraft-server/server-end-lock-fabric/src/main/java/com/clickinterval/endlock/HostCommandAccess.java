package com.clickinterval.endlock;

import java.util.UUID;

/** Integrated host identity and ordinary cheat permission are both required; LAN operators are not hosts. */
final class HostCommandAccess {
    static boolean allowed(boolean dedicated, UUID hostId, UUID playerId, boolean vanillaOwner,
                           boolean genuinePlayerSource, boolean cheatsPermitted) {
        return !dedicated && hostId != null && hostId.equals(playerId) && vanillaOwner
                && genuinePlayerSource && cheatsPermitted;
    }

    private HostCommandAccess() { }
}
