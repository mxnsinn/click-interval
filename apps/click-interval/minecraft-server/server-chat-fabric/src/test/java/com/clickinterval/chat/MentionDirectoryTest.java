package com.clickinterval.chat;

import com.clickinterval.chat.protocol.MentionNames;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class MentionDirectoryTest {
    private final UUID alice = UUID.randomUUID();
    private final UUID bob = UUID.randomUUID();

    @Test void publicCompletionsContainPlayersTagsAndQuotedFullNames() {
        var groups = Map.of("VRG", Set.of(alice), "Night Watch", Set.of(alice));
        assertEquals(List.of("@\"Night Watch\"", "@Alice", "@Bob", "@VRG"),
                MentionDirectory.completions(List.of("Alice", "alice", "Bob", "bad/name"), groups));
        assertEquals(List.of("Night Watch", "VRG"), MentionDirectory.ownNames(alice, groups));
        assertEquals(List.of(), MentionDirectory.ownNames(bob, groups));
    }

    @Test void joinLeaveRenameAndDisbandReplaceRecipientAliasesWithoutStaleNames() {
        var initial = Map.of("VRG", Set.of(alice), "Night Watch", Set.of(alice));
        var joined = Map.of("VRG", Set.of(alice, bob), "Night Watch", Set.of(alice, bob));
        assertEquals(List.of("Night Watch", "VRG"), MentionDirectory.ownNames(bob, joined));
        assertEquals(List.of(), MentionDirectory.ownNames(bob, initial));
        var renamed = Map.of("NEW", Set.of(alice), "Day Watch", Set.of(alice));
        assertEquals(List.of("Day Watch", "NEW"), MentionDirectory.ownNames(alice, renamed));
        assertEquals(List.of("@Alice"), MentionDirectory.completions(List.of("Alice"), Map.of()));
        assertTrue(MentionDirectory.ownNames(alice, Map.of()).isEmpty());
    }

    @Test void namesCannotInjectQuotesCommandsFormattingOrControlCharacters() {
        for (String name : List.of("", " ", "bad\nname", "§aTeam", "bad\"name", "@all", "/msg", "a".repeat(33), " Team")) {
            assertFalse(MentionNames.valid(name), name);
            assertThrows(IllegalArgumentException.class, () -> MentionNames.token(name));
        }
        assertEquals("@VRG", MentionNames.token("VRG"));
        assertEquals("@\"Night Watch\"", MentionNames.token("Night Watch"));
    }

    @Test void optionalBridgeRejectsMalformedValuesAndReturnsImmutableSnapshots() {
        assertTrue(TeamMentionsBridge.sanitize("not a map").isEmpty());
        var clean = TeamMentionsBridge.sanitize(Map.of("VRG", Set.of(alice, "not uuid"), "bad\nname", Set.of(bob)));
        assertEquals(Map.of("VRG", Set.of(alice)), clean);
        assertThrows(UnsupportedOperationException.class, () -> clean.put("NEW", Set.of(bob)));
        assertThrows(UnsupportedOperationException.class, () -> clean.get("VRG").add(bob));
        assertTrue(new TeamMentionsBridge().groups().isEmpty(), "tests intentionally omit optional Team API");
    }

    @Test void completionAndRecipientDirectorySizesAreBounded() {
        java.util.HashMap<String, Set<UUID>> groups = new java.util.HashMap<>();
        for (int i = 0; i < 1200; i++) groups.put("Team" + i, Set.of(alice));
        assertEquals(1024, MentionDirectory.completions(List.of(), groups).size());
        assertEquals(64, MentionDirectory.ownNames(alice, groups).size());
        assertEquals(1200, TeamMentionsBridge.sanitize(groups).size());
    }
}
