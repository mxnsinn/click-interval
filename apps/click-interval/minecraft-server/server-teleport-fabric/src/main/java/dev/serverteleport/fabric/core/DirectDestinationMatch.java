package dev.serverteleport.fabric.core;

/**
 * Collision-safe result for the shorthand {@code /tpa <destination>} command.
 *
 * <p>The caller performs exact saved-place and online-player lookups first. Keeping the decision
 * table separate makes it impossible for a saved place to silently fall through into a player
 * request when both namespaces contain the same name.</p>
 */
public enum DirectDestinationMatch {
    SAVED_PLACE,
    ONLINE_PLAYER,
    AMBIGUOUS,
    NOT_FOUND;

    public static DirectDestinationMatch resolve(boolean savedPlaceExists, boolean onlinePlayerExists) {
        if (savedPlaceExists && onlinePlayerExists) return AMBIGUOUS;
        if (savedPlaceExists) return SAVED_PLACE;
        if (onlinePlayerExists) return ONLINE_PLAYER;
        return NOT_FOUND;
    }
}
