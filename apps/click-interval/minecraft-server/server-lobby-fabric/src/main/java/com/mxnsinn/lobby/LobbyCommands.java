package com.mxnsinn.lobby;

import java.util.Set;

/** Only communication/help commands can run as a protected lobby player. Console remains unrestricted. */
public final class LobbyCommands {
    private static final Set<String> ALLOWED = Set.of("help", "list", "me", "msg", "tell", "w", "teammsg", "tm", "voicechat");
    private LobbyCommands() {}
    public static boolean allowed(String command) {
        if (command == null) return false;
        String value = command.stripLeading();
        if (value.startsWith("/")) value = value.substring(1);
        int end = 0;
        while (end < value.length() && !Character.isWhitespace(value.charAt(end))) end++;
        String root = value.substring(0, end);
        if (root.startsWith("minecraft:")) root = root.substring("minecraft:".length());
        return ALLOWED.contains(root);
    }
}
