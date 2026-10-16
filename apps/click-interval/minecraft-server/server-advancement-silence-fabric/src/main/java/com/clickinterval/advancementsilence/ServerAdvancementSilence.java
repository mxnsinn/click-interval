package com.clickinterval.advancementsilence;

import com.clickinterval.advancementsilence.mixin.CachedProfileAccessor;
import com.clickinterval.advancementsilence.mixin.CommandSourceAccessor;
import com.clickinterval.advancementsilence.mixin.NameCacheAccessor;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.NameAndId;
import net.minecraft.server.rcon.RconConsoleSource;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.util.*;

public final class ServerAdvancementSilence implements ModInitializer {
    private static final Logger LOG = LoggerFactory.getLogger("ServerAdvancementSilence");
    private static final Map<MinecraftServer, SilenceStore> STORES = new IdentityHashMap<>();
    private static final Set<MinecraftServer> LOAD_FAILED = Collections.newSetFromMap(new IdentityHashMap<>());

    @Override public void onInitialize() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registry, environment) -> {
            for (boolean value : new boolean[]{true, false}) {
                dispatcher.register(Commands.literal(value ? "silence" : "unsilence")
                        .requires(ServerAdvancementSilence::consoleOnly)
                        .then(Commands.literal("advancement")
                                .then(Commands.argument("player", StringArgumentType.word())
                                        .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                                context.getSource().getServer().getPlayerList().getPlayerNamesArray(), builder))
                                        .executes(context -> change(context.getSource(), StringArgumentType.getString(context, "player"), value)))));
            }
        });
        ServerLifecycleEvents.SERVER_STARTING.register(ServerAdvancementSilence::load);
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> { STORES.remove(server); LOAD_FAILED.remove(server); });
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            if (Boolean.getBoolean("clickinterval.advancementSilence.selftest")) AdvancementSelfTest.run(server);
        });
    }

    private static void load(MinecraftServer server) {
        try {
            SilenceStore store = new SilenceStore(server.getWorldPath(LevelResource.ROOT).resolve("server-advancement-silence.json"));
            STORES.put(server, store);
            LOG.info("Advancement announcement settings loaded: {} silenced UUID(s)", store.size());
        } catch (IOException failure) {
            LOAD_FAILED.add(server);
            LOG.error("Cannot load advancement silence settings. Commands are disabled and vanilla announcements remain unchanged; existing settings were not overwritten.", failure);
        }
    }

    public static boolean isSilenced(ServerPlayer player) {
        SilenceStore store = STORES.get(player.level().getServer());
        return store != null && store.contains(player.getUUID());
    }

    static boolean consoleOnly(CommandSourceStack source) {
        // Checking the backing source (not permission level) excludes OPs, command blocks, and execute-as players.
        Object caller = ((CommandSourceAccessor) source).advancementSilence$source();
        return source.getEntity() == null && (caller instanceof MinecraftServer || caller instanceof RconConsoleSource);
    }

    static Optional<NameAndId> resolveKnown(MinecraftServer server, String name) {
        if (!name.matches("[A-Za-z0-9_]{1,16}")) return Optional.empty();
        ServerPlayer online = server.getPlayerList().getPlayerByName(name);
        if (online != null) return Optional.of(new NameAndId(online.getGameProfile()));
        // Vanilla get(name) can perform network lookup or synthesize an offline UUID. Never call it.
        if (!(server.services().nameToIdCache() instanceof NameCacheAccessor cache)) return Optional.empty();
        Object entry = cache.advancementSilence$cachedNames().get(name.toLowerCase(Locale.ROOT));
        if (!(entry instanceof CachedProfileAccessor profile) || profile.advancementSilence$expiration().getTime() <= System.currentTimeMillis())
            return Optional.empty();
        NameAndId identity = profile.advancementSilence$identity();
        return identity.name().equalsIgnoreCase(name) ? Optional.of(identity) : Optional.empty();
    }

    static int change(CommandSourceStack source, String name, boolean value) {
        if (!consoleOnly(source)) return 0;
        var server = source.getServer();
        SilenceStore store = STORES.get(server);
        if (store == null || LOAD_FAILED.contains(server)) {
            source.sendFailure(Component.literal("Advancement silence settings could not be loaded. Check the server log; no settings were changed."));
            return 0;
        }
        Optional<NameAndId> target = resolveKnown(server, name);
        if (target.isEmpty()) {
            source.sendFailure(Component.literal("Unknown or expired player name. Use their exact username while they are online; no settings were changed."));
            return 0;
        }
        try {
            NameAndId player = target.get();
            boolean changed = store.set(player.id(), value);
            source.sendSuccess(() -> Component.literal(player.name() + " [" + player.id() + "]: advancement chat announcements "
                    + (value ? "silenced" : "enabled") + (changed ? "." : " (already set).")), false);
            return 1;
        } catch (IOException failure) {
            LOG.error("Unable to save advancement silence settings; in-memory settings remain unchanged", failure);
            source.sendFailure(Component.literal("Could not save advancement settings. No setting was changed."));
            return 0;
        }
    }
}
