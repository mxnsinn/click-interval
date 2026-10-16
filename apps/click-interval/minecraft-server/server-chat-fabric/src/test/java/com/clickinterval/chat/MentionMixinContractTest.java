package com.clickinterval.chat;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;
import static org.junit.jupiter.api.Assertions.*;

final class MentionMixinContractTest {
    @Test void realVanillaSendHookRunsBeforeUnmodifiedSignatureCacheAndLastSeenAccounting() throws Exception {
        var node = read("net/minecraft/server/network/ServerGamePacketListenerImpl");
        var method = node.methods.stream().filter(m -> m.name.equals("sendPlayerChatMessage")).findFirst().orElseThrow();
        int sendCount=0, cachePush=-1, pending=-1, send=-1, position=0;
        for (var instruction : method.instructions) {
            position++;
            if (instruction instanceof MethodInsnNode call) {
                if (call.owner.equals("net/minecraft/server/network/ServerGamePacketListenerImpl") && call.name.equals("send")) {sendCount++;send=position;}
                if (call.owner.equals("net/minecraft/network/chat/MessageSignatureCache") && call.name.equals("push")) cachePush=position;
                if (call.owner.equals("net/minecraft/network/chat/LastSeenMessagesValidator") && call.name.equals("addPending")) pending=position;
            }
        }
        assertEquals(1, sendCount);
        assertTrue(cachePush > send && pending > send);
        var mixin = read("com/clickinterval/chat/mixin/RecipientMentionMixin");
        var hook = mixin.methods.stream().filter(m -> m.name.equals("serverChat$decorateRecipient")).findFirst().orElseThrow();
        assertNotNull(hook.visibleAnnotations.stream().filter(a -> a.desc.endsWith("/ModifyArg;")).findFirst().orElse(null));
        assertTrue(hook.visibleAnnotations.stream().noneMatch(a -> a.desc.endsWith("/Inject;")));
        for (var instruction : hook.instructions) if (instruction instanceof MethodInsnNode call) {
            assertEquals("com/clickinterval/chat/ServerChat", call.owner);
            assertEquals("decorateOutgoing", call.name);
        }
    }

    private static ClassNode read(String name) throws Exception {
        try (var input = MentionMixinContractTest.class.getResourceAsStream("/" + name + ".class")) {
            assertNotNull(input); var node = new ClassNode(); new ClassReader(input).accept(node, 0); return node;
        }
    }
}
