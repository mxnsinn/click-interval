package com.clickinterval.chat;

import com.clickinterval.chat.protocol.MentionNames;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Optional read-only Team API; absence or incompatible data never interrupts normal chat. */
final class TeamMentionsBridge {
    private Method groups;
    private Method revision;

    TeamMentionsBridge() {
        try {
            Class<?> api = Class.forName("dev.serverteams.fabric.TeamApi");
            groups = api.getMethod("mentionGroups");
            revision = api.getMethod("revision");
        } catch (ReflectiveOperationException | LinkageError ignored) { }
    }

    long revision() {
        try { return revision == null ? 0 : ((Number) revision.invoke(null)).longValue(); }
        catch (ReflectiveOperationException | RuntimeException | LinkageError ignored) { return Long.MIN_VALUE; }
    }

    Map<String, Set<UUID>> groups() {
        try { return groups == null ? Map.of() : sanitize(groups.invoke(null)); }
        catch (ReflectiveOperationException | RuntimeException | LinkageError ignored) { return Map.of(); }
    }

    static Map<String, Set<UUID>> sanitize(Object input) {
        if (!(input instanceof Map<?, ?> map)) return Map.of();
        Map<String, Set<UUID>> result = new LinkedHashMap<>();
        for (var entry : map.entrySet()) {
            // TeamStore supports 4096 teams, each with a tag and full-name alias.
            // Completion presentation is capped separately; never drop a recipient's own team.
            if (result.size() >= 8192) break;
            if (!(entry.getKey() instanceof String name) || !MentionNames.valid(name)
                    || !(entry.getValue() instanceof Set<?> members) || members.size() > 1024) continue;
            Set<UUID> ids = new java.util.HashSet<>();
            for (Object member : members) if (member instanceof UUID id) ids.add(id);
            result.put(name, Set.copyOf(ids));
        }
        return Map.copyOf(result);
    }
}
