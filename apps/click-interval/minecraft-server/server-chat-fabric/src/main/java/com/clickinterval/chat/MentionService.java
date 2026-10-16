package com.clickinterval.chat;

import com.clickinterval.chat.protocol.MentionContextPayload;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.protocol.game.ClientboundCustomChatCompletionsPacket;
import net.minecraft.server.MinecraftServer;

/** Bounded directory updates, never a chat listener: signed/public/private messages remain untouched. */
final class MentionService {
    private final TeamMentionsBridge teams = new TeamMentionsBridge();
    private final Map<UUID, List<String>> sentCompletions = new HashMap<>();
    private final Map<UUID, List<String>> sentNames = new HashMap<>();
    private Map<String, Set<UUID>> groups = Map.of();
    private final Map<UUID, List<String>> recipientNames = new HashMap<>();
    private long revision = Long.MIN_VALUE;
    private int ticks;

    void register() {
        MentionContextPayload.register();
        ServerLifecycleEvents.SERVER_STARTING.register(server -> reset());
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> reset());
        ServerTickEvents.END_SERVER_TICK.register(this::tick);
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            sentCompletions.remove(handler.getPlayer().getUUID());
            sentNames.remove(handler.getPlayer().getUUID());
            recipientNames.remove(handler.getPlayer().getUUID());
        });
    }

    private void reset() {
        sentCompletions.clear(); sentNames.clear(); recipientNames.clear(); groups = Map.of(); revision = Long.MIN_VALUE; ticks = 19;
    }

    private void refreshGroups() {
        long currentRevision = teams.revision();
        if (revision != currentRevision) {
            groups = teams.groups(); revision = currentRevision; recipientNames.clear();
        }
    }

    List<String> ownNames(UUID recipient) {
        // Chat runs on the server thread. Re-check revision so membership changes take effect immediately.
        refreshGroups();
        List<String> names = recipientNames.get(recipient);
        if (names == null) {
            names = MentionDirectory.ownNames(recipient, groups);
            if (recipientNames.size() < 1024) recipientNames.put(recipient, names);
        }
        return names;
    }

    private void tick(MinecraftServer server) {
        // At most one directory pass/second, coalescing any rapid join/leave/team mutations.
        if (++ticks < 20) return;
        ticks = 0;
        refreshGroups();
        var players = server.getPlayerList().getPlayers();
        List<String> completions = MentionDirectory.completions(players.stream().map(player -> player.getGameProfile().name()).toList(), groups);
        for (var player : players) {
            UUID id = player.getUUID();
            List<String> previous = sentCompletions.getOrDefault(id, List.of());
            if (!previous.equals(completions)) {
                Set<String> currentSet = Set.copyOf(completions), previousSet = Set.copyOf(previous);
                List<String> removed = previous.stream().filter(value -> !currentSet.contains(value)).toList();
                List<String> added = completions.stream().filter(value -> !previousSet.contains(value)).toList();
                // ADD/REMOVE only our entries; SET would wipe other mods' custom chat suggestions.
                if (!removed.isEmpty()) player.connection.send(new ClientboundCustomChatCompletionsPacket(ClientboundCustomChatCompletionsPacket.Action.REMOVE, removed));
                if (!added.isEmpty()) player.connection.send(new ClientboundCustomChatCompletionsPacket(ClientboundCustomChatCompletionsPacket.Action.ADD, added));
            }
            sentCompletions.put(id, completions);
            if (ServerPlayNetworking.canSend(player, MentionContextPayload.TYPE)) {
                List<String> ownNames = ownNames(id);
                if (!ownNames.equals(sentNames.get(id))) {
                    ServerPlayNetworking.send(player, new MentionContextPayload(ownNames));
                    sentNames.put(id, ownNames);
                }
            }
        }
    }
}
