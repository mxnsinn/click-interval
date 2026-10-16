package dev.serverprotection.client;

import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Negative packaging contracts: deleted behavior must not survive through shared sources or stale classes. */
final class TypingRemovalContractTest {
    @Test void removedTypingClassesAndChatHooksAreAbsentFromRuntimeClasspath() {
        for (String name : List.of("dev/serverprotection/client/TypingIndicatorClient",
                "dev/serverprotection/client/TypingInputPolicy", "dev/serverprotection/client/TypingSignalController",
                "dev/serverprotection/client/TypingSummaryState", "dev/serverprotection/client/mixin/ChatScreenAccessor",
                "dev/serverprotection/client/mixin/ChatScreenCloseMixin", "dev/serverprotection/fabric/typing/TypingStatusPayload",
                "dev/serverprotection/fabric/typing/TypingSummaryPayload")) {
            assertNull(getClass().getResource("/" + name + ".class"), name);
        }
    }

    @Test void productionBytecodeHasNoTypingProtocolOrHudReferences() throws IOException {
        Path classes = Path.of("build/classes/java/main");
        assertTrue(Files.isDirectory(classes));
        int checked = 0;
        try (var paths = Files.walk(classes)) {
            for (Path file : paths.filter(path -> path.toString().endsWith(".class")).toList()) {
                String constants = new String(Files.readAllBytes(file), StandardCharsets.ISO_8859_1);
                for (String forbidden : List.of("fabric/typing/", "TypingIndicator", "TypingSignal", "TypingSummary",
                        "TypingInput", "typing_status", "typing_summary", "typing_indicator", "public_chat_typing", "chatScreenRemoved")) {
                    assertFalse(constants.contains(forbidden), file + " references " + forbidden);
                }
                checked++;
            }
        }
        assertTrue(checked > 10, "Production classes were actually inspected");
    }

    @Test void mixinsKeepMentionsAndOptionalSelfNameWithoutTypingScreenHooks() throws IOException {
        try (var input = getClass().getResourceAsStream("/serverprotection.companion.mixins.json")) {
            assertNotNull(input);
            var mixins = JsonParser.parseReader(new InputStreamReader(input, StandardCharsets.UTF_8))
                    .getAsJsonObject().getAsJsonArray("client");
            var names = mixins.asList().stream().map(value -> value.getAsString()).toList();
            assertTrue(names.containsAll(List.of("ChatMentionMixin", "ChatMentionSuggestionsMixin", "SelfNameTagMixin")));
            assertFalse(names.contains("ChatScreenAccessor"));
            assertFalse(names.contains("ChatScreenCloseMixin"));
        }
        for (String name : List.of("dev/serverprotection/client/MentionContextClient",
                "dev/serverprotection/client/SelfNameTagClient", "dev/serverprotection/client/PlayerViewClientSession",
                "dev/serverprotection/client/AttestationPayload", "com/clickinterval/chat/protocol/MentionContextPayload")) {
            assertNotNull(getClass().getResource("/" + name + ".class"), name);
        }
    }

    @Test void packagedDescriptionDoesNotAdvertiseRemovedFeature() throws IOException {
        try (var input = getClass().getResourceAsStream("/fabric.mod.json")) {
            assertNotNull(input);
            var metadata = JsonParser.parseReader(new InputStreamReader(input, StandardCharsets.UTF_8)).getAsJsonObject();
            assertFalse(metadata.get("description").getAsString().toLowerCase(java.util.Locale.ROOT).contains("typing"));
            assertEquals("1.5.3", metadata.get("version").getAsString());
        }
    }
}
