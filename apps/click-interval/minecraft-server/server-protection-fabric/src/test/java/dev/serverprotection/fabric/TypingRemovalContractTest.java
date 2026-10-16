package dev.serverprotection.fabric;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Reads bytecode without initializing the native server or registering any runtime handlers. */
final class TypingRemovalContractTest {
    @Test void entrypointHasNoTypingFieldReceiverOrLifecycleCalls() throws Exception {
        String symbols;
        try (var input = getClass().getResourceAsStream("/dev/serverprotection/fabric/ServerProtectionFabric.class")) {
            assertNotNull(input);
            symbols = new String(input.readAllBytes(), StandardCharsets.ISO_8859_1);
        }
        for (String removed : new String[]{"/typing/", "typingIndicators", "TypingIndicatorService",
                "public_chat_typing", "public_chat_typing_summary"}) {
            assertFalse(symbols.contains(removed), removed);
        }
        for (String retained : new String[]{"clientAttestation", "playerViews", "entityControl",
                "allowChatMessage", "onServerTick", "handleSharedTeamSuggestions"}) {
            assertTrue(symbols.contains(retained), retained);
        }
    }

    @Test void formerTypingImplementationAndWireCodecsAreNotPackaged() {
        for (String name : new String[]{"TypingIndicatorService", "TypingIndicatorTracker",
                "TypingStatusPayload", "TypingSummaryPayload"}) {
            assertNull(getClass().getResource("/dev/serverprotection/fabric/typing/" + name + ".class"), name);
        }
    }
}
