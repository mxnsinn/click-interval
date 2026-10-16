package dev.serverprotection.fabric;

/** Pure fail-closed validation for transient player states that camera teleport cannot restore. */
final class PlayerViewStartGuard {
    private PlayerViewStartGuard() { }

    static String rejection(boolean alive, boolean changingDimension, boolean sleeping,
                            boolean passenger, boolean vehicle, boolean fallFlying,
                            boolean usingItem, boolean inventoryMenuActive) {
        if (!alive || changingDimension) {
            return "Wait until you have finished respawning or changing dimensions.";
        }
        if (sleeping) return "Leave your bed before viewing another player.";
        if (passenger || vehicle) return "Dismount and remove any passengers before viewing another player.";
        if (fallFlying) return "Stop fall-flying before viewing another player.";
        if (usingItem) return "Finish using your current item before viewing another player.";
        if (!inventoryMenuActive) return "Close your current menu before viewing another player.";
        return "";
    }
}
