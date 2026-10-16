package dev.custominchat.client;

import com.mojang.brigadier.tree.CommandNode;

/** Do not send to an unrelated mod that happens to own the same root command. */
final class CommandTreeSupport {
    private CommandTreeSupport() {}

    static boolean supports(CommandNode<?> root) {
        if (root == null) return false;
        var menu = root.getChild("enchants");
        if (menu == null) return false;
        var toggle = menu.getChild("toggle");
        return toggle != null && toggle.getChild("miner") != null
                && toggle.getChild("tree") != null && toggle.getChild("harvester") != null;
    }
}
