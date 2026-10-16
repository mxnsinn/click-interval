package dev.serverteams.fabric;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.suggestion.SuggestionProvider;

/** Plain Brigadier routes: vanilla clients need neither native dialogs nor a companion. */
final class TeamCommandRoutes {
    private TeamCommandRoutes() {}
    @FunctionalInterface interface Handler<S> {
        int run(S source, String action, String value, String extra) throws CommandSyntaxException;
    }
    private static <S> LiteralArgumentBuilder<S> literal(String name) {
        return LiteralArgumentBuilder.literal(name);
    }
    private static <S> RequiredArgumentBuilder<S, String> word(String name) {
        return RequiredArgumentBuilder.argument(name, StringArgumentType.word());
    }
    private static <S> RequiredArgumentBuilder<S, String> text(String name) {
        return RequiredArgumentBuilder.argument(name, StringArgumentType.greedyString());
    }
    private static <S> RequiredArgumentBuilder<S, String> create(Handler<S> handler) {
        return TeamCommandRoutes.<S>word("tag")
            .executes(c -> handler.run(c.getSource(), "create", StringArgumentType.getString(c, "tag"), ""))
            .then(TeamCommandRoutes.<S>text("name").executes(c -> handler.run(c.getSource(), "create",
                StringArgumentType.getString(c, "tag"), StringArgumentType.getString(c, "name"))));
    }
    private static <S> LiteralArgumentBuilder<S> one(String route, String action, String argument, Handler<S> handler) {
        return one(route,action,argument,handler,(c,b)->b.buildFuture());
    }
    private static <S> LiteralArgumentBuilder<S> one(String route, String action, String argument, Handler<S> handler, SuggestionProvider<S> suggestions) {
        return TeamCommandRoutes.<S>literal(route).then(TeamCommandRoutes.<S>word(argument)
            .suggests(suggestions)
            .executes(c -> handler.run(c.getSource(), action, StringArgumentType.getString(c, argument), "")));
    }
    private static <S> LiteralArgumentBuilder<S> disband(String route, Handler<S> handler) {
        return TeamCommandRoutes.<S>literal(route)
            .executes(c -> handler.run(c.getSource(), "disband-help", "", ""))
            .then(TeamCommandRoutes.<S>word("tag")
                .then(TeamCommandRoutes.<S>literal("confirm").executes(c ->
                    handler.run(c.getSource(), "disband", StringArgumentType.getString(c, "tag"), ""))));
    }
    static <S> void register(CommandDispatcher<S> dispatcher, Handler<S> handler) {
        register(dispatcher,handler,(c,b)->b.buildFuture());
    }
    static <S> void register(CommandDispatcher<S> dispatcher, Handler<S> handler, SuggestionProvider<S> players) {
        var root = TeamCommandRoutes.<S>literal("teams")
            .executes(c -> handler.run(c.getSource(), "help", "", ""))
            .then(TeamCommandRoutes.<S>literal("help").executes(c -> handler.run(c.getSource(), "help", "", "")))
            .then(TeamCommandRoutes.<S>literal("list").executes(c -> handler.run(c.getSource(), "list", "", "")))
            .then(TeamCommandRoutes.<S>literal("invites").executes(c -> handler.run(c.getSource(), "invites", "", "")))
            .then(TeamCommandRoutes.<S>literal("hub").executes(c -> handler.run(c.getSource(), "hub", "", "")))
            .then(TeamCommandRoutes.<S>literal("settings").executes(c -> handler.run(c.getSource(), "settings", "", "")))
            .then(TeamCommandRoutes.<S>literal("create").then(create(handler)))
            .then(one("invite", "invite", "player", handler, players))
            .then(TeamCommandRoutes.<S>literal("accept")
                .executes(c -> handler.run(c.getSource(), "accept", "", ""))
                .then(TeamCommandRoutes.<S>word("tag").executes(c ->
                    handler.run(c.getSource(), "accept", StringArgumentType.getString(c, "tag"), ""))))
            .then(one("decline", "decline", "tag", handler))
            .then(TeamCommandRoutes.<S>literal("leave").executes(c -> handler.run(c.getSource(), "leave", "", "")))
            .then(disband("disband", handler))
            .then(one("kick", "kick", "player", handler, players))
            .then(one("transfer", "transfer", "player", handler, players))
            .then(one("tag", "tag", "tag", handler))
            .then(one("color", "color", "color", handler))
            .then(TeamCommandRoutes.<S>literal("name").then(TeamCommandRoutes.<S>text("name").executes(c ->
                handler.run(c.getSource(), "name", StringArgumentType.getString(c, "name"), ""))));
        var trust = TeamCommandRoutes.<S>literal("trust").then(TeamCommandRoutes.<S>word("player")
            .suggests(players)
            .then(TeamCommandRoutes.<S>literal("on").executes(c ->
                handler.run(c.getSource(), "trust", StringArgumentType.getString(c, "player"), "on")))
            .then(TeamCommandRoutes.<S>literal("off").executes(c ->
                handler.run(c.getSource(), "trust", StringArgumentType.getString(c, "player"), "off"))));
        root.then(trust);
        var alerts = TeamCommandRoutes.<S>literal("alerts");
        for (String setting : new String[]{"on", "off"}) alerts.then(TeamCommandRoutes.<S>literal(setting)
            .executes(c -> handler.run(c.getSource(), "alerts", setting, "")));
        root.then(alerts);
        dispatcher.register(root);
        dispatcher.register(TeamCommandRoutes.<S>literal("create;team").then(create(handler)));
        dispatcher.register(one("team;invite", "invite", "player", handler, players));
        dispatcher.register(one("team;accept", "accept", "tag", handler));
        dispatcher.register(one("team;decline", "decline", "tag", handler));
        dispatcher.register(TeamCommandRoutes.<S>literal("team;leave").executes(c -> handler.run(c.getSource(), "leave", "", "")));
        dispatcher.register(disband("team;disband", handler));
        // Merge only the argument route; the existing zero-argument native form remains.
        dispatcher.register(TeamCommandRoutes.<S>literal("create")
            .then(TeamCommandRoutes.<S>literal("team").then(create(handler))));
    }
}
