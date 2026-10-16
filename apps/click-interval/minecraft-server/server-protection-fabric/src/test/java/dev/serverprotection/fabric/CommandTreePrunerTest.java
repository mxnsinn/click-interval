package dev.serverprotection.fabric;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.tree.CommandNode;
import com.mojang.brigadier.tree.RootCommandNode;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

final class CommandTreePrunerTest {
    @Test
    void elevatedSourceDoesNotLeakPrivilegedChildrenOfSharedTeamRoot() {
        CommandDispatcher<String> dispatcher = new CommandDispatcher<>();
        dispatcher.register(LiteralArgumentBuilder.<String>literal("team")
                .then(LiteralArgumentBuilder.<String>literal("settings"))
                .then(LiteralArgumentBuilder.<String>literal("join").requires("all"::equals))
                .then(LiteralArgumentBuilder.<String>literal("modify").requires("all"::equals)));
        dispatcher.register(LiteralArgumentBuilder.<String>literal("create")
                .then(LiteralArgumentBuilder.<String>literal("team"))
                .then(LiteralArgumentBuilder.<String>literal("op").requires("all"::equals)));
        var filtered = CommandTreePruner.copy(dispatcher.getRoot(), "all", ignored -> true,
                Set.of("team settings", "create team")::contains);
        assertEquals(Set.of("settings"), filtered.getChild("team").getChildren().stream()
                .map(CommandNode::getName).collect(Collectors.toSet()));
        assertEquals(Set.of("team"), filtered.getChild("create").getChildren().stream()
                .map(CommandNode::getName).collect(Collectors.toSet()));
        CommandDispatcher<String> safe = new CommandDispatcher<>(filtered);
        assertEquals(Set.of("settings"), safe.getCompletionSuggestions(safe.parse("team ", "all")).join()
                .getList().stream().map(com.mojang.brigadier.suggestion.Suggestion::getText).collect(Collectors.toSet()));
        assertEquals(Set.of("team"), safe.getCompletionSuggestions(safe.parse("create ", "all")).join()
                .getList().stream().map(com.mojang.brigadier.suggestion.Suggestion::getText).collect(Collectors.toSet()));
    }

    @Test
    void allowlistRoleReceivesOnlyGrantedRoots() {
        CommandDispatcher<String> dispatcher = dispatcher();
        RootCommandNode<String> filtered = CommandTreePruner.copy(
                dispatcher.getRoot(), "all", Set.of("kick", "ban", "ci-spectate")::contains);

        assertEquals(Set.of("kick", "ban", "ci-spectate"), names(filtered));
        assertNull(filtered.getChild("gamemode"));
        assertNull(filtered.getChild("give"));
        assertNull(filtered.getChild("stop"));
    }

    @Test
    void vanillaRestrictedSourceCannotHavePrivilegedNodesResurrected() {
        CommandDispatcher<String> dispatcher = dispatcher();
        RootCommandNode<String> filtered = CommandTreePruner.copy(
                dispatcher.getRoot(), "none", ignored -> true);
        assertEquals(Set.of("tpa"), names(filtered));
    }

    @Test
    void redirectCannotPullAPrunedRootBackIntoThePacketGraph() {
        CommandDispatcher<String> dispatcher = dispatcher();
        CommandNode<String> gamemode = dispatcher.getRoot().getChild("gamemode");
        dispatcher.getRoot().addChild(LiteralArgumentBuilder.<String>literal("gm").redirect(gamemode).build());

        RootCommandNode<String> deniedTarget = CommandTreePruner.copy(
                dispatcher.getRoot(), "all", "gm"::equals);
        assertEquals(Set.of(), names(deniedTarget), "the unsafe alias must fail closed");

        RootCommandNode<String> allowedTarget = CommandTreePruner.copy(
                dispatcher.getRoot(), "all", Set.of("gamemode", "gm")::contains);
        assertSame(allowedTarget.getChild("gamemode"), allowedTarget.getChild("gm").getRedirect());
    }

    private static CommandDispatcher<String> dispatcher() {
        CommandDispatcher<String> dispatcher = new CommandDispatcher<>();
        dispatcher.register(LiteralArgumentBuilder.<String>literal("tpa").executes(context -> 1));
        for (String root : Set.of("kick", "ban", "ci-spectate", "gamemode", "give", "stop")) {
            dispatcher.register(LiteralArgumentBuilder.<String>literal(root)
                    .requires("all"::equals).executes(context -> 1));
        }
        return dispatcher;
    }

    private static Set<String> names(RootCommandNode<String> root) {
        return root.getChildren().stream().map(CommandNode::getName).collect(Collectors.toSet());
    }
}
