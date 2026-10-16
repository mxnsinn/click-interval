package com.clickinterval.chat;

import com.clickinterval.chat.protocol.MentionContextPayload;
import com.clickinterval.chat.protocol.MentionNames;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

final class MentionDirectory {
    static final int MAX_COMPLETIONS = 1024;
    private MentionDirectory() { }

    static List<String> completions(Collection<String> players, Map<String, Set<UUID>> groups) {
        TreeSet<String> tokens = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (String name : players) if (name != null && name.matches("[A-Za-z0-9_]{1,16}")) tokens.add("@" + name);
        for (String name : groups.keySet()) if (MentionNames.valid(name)) tokens.add(MentionNames.token(name));
        return tokens.stream().limit(MAX_COMPLETIONS).toList();
    }

    static List<String> ownNames(UUID recipient, Map<String, Set<UUID>> groups) {
        return groups.entrySet().stream().filter(entry -> entry.getValue().contains(recipient))
                .map(Map.Entry::getKey).filter(MentionNames::valid).sorted(String.CASE_INSENSITIVE_ORDER)
                .limit(MentionContextPayload.MAX_NAMES).toList();
    }
}
