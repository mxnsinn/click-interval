package com.clickinterval.chat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;

import static org.junit.jupiter.api.Assertions.*;

final class TypingRemovalContractTest {
    @Test void initializerRegistersOnlyMentionDirectoryAndNoTypingReceiverOrTick() throws Exception {
        byte[] bytes;
        try (var input = getClass().getResourceAsStream("/com/clickinterval/chat/ServerChat.class")) {
            assertNotNull(input);
            bytes = input.readAllBytes();
        }
        var node = new ClassNode();
        new ClassReader(bytes).accept(node, 0);
        var initializer = node.methods.stream().filter(method -> method.name.equals("onInitialize")).findFirst().orElseThrow();
        int directoryRegistrations = 0;
        for (var instruction : initializer.instructions) {
            if (instruction instanceof MethodInsnNode call) {
                assertTrue(call.owner.equals("com/clickinterval/chat/MentionService")
                        || call.owner.equals("org/slf4j/Logger"), call.owner + "." + call.name);
                if (call.owner.equals("com/clickinterval/chat/MentionService") && call.name.equals("register")) {
                    directoryRegistrations++;
                }
            }
        }
        assertEquals(1, directoryRegistrations);
        String symbols = new String(bytes, StandardCharsets.ISO_8859_1);
        assertFalse(symbols.contains("public_chat_typing"));
        assertFalse(symbols.contains("RelayOwnership"));
        assertFalse(symbols.contains("dev/serverprotection"));
    }

    @Test void removedRelayAndWireAssetsAreAbsentButMentionProtocolRemains() {
        for (String name : new String[]{"TypingIndicatorService", "TypingIndicatorTracker",
                "TypingStatusPayload", "TypingSummaryPayload"}) {
            assertNull(getClass().getResource("/dev/serverprotection/fabric/typing/" + name + ".class"), name);
        }
        assertNull(getClass().getResource("/com/clickinterval/chat/RelayOwnership.class"));
        assertNotNull(getClass().getResource("/com/clickinterval/chat/protocol/MentionContextPayload.class"));
    }
}
