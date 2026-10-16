package dev.serverprotection.client;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.AnnotationNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Compile-time game-class contract checks for both Minecraft variants without starting a client. */
final class ChatMixinContractTest {
    @Test
    void modifiesOnlyDisplayComponentAtExistingPlayerMessageEntryPoint() throws IOException {
        String descriptor = "(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/multiplayer/chat/GuiMessageTag;)V";
        assertTrue(read("net/minecraft/client/gui/components/ChatComponent").methods.stream()
                .anyMatch(method -> method.name.equals("addPlayerMessage") && method.desc.equals(descriptor)));
        ClassNode mixin = read("dev/serverprotection/client/mixin/ChatMentionMixin");
        var method = mixin.methods.stream().filter(candidate -> candidate.name.contains("highlightOwnMention"))
                .findFirst().orElseThrow();
        assertEquals("(Lnet/minecraft/network/chat/Component;)Lnet/minecraft/network/chat/Component;", method.desc);
        AnnotationNode annotation = method.visibleAnnotations.stream()
                .filter(value -> value.desc.endsWith("/ModifyVariable;")).findFirst().orElseThrow();
        assertEquals(List.of("addPlayerMessage" + descriptor), value(annotation, "method"));
        assertEquals(true, value(annotation, "argsOnly"));
        assertEquals(0, value(annotation, "ordinal"));
        for (var instruction : method.instructions) {
            if (instruction instanceof MethodInsnNode call) {
                assertFalse(call.owner.contains("Networking") || call.name.contains("send")
                        || call.name.contains("Sound") || call.name.contains("Title"), call.owner + "." + call.name);
            }
        }
    }

    @Test
    void automaticMentionMixinUsesExistingNativeSuggestionFieldsAndTailHookWithoutNetworking() throws IOException {
        ClassNode target = read("net/minecraft/client/gui/components/CommandSuggestions");
        ClassNode mixin = read("dev/serverprotection/client/mixin/ChatMentionSuggestionsMixin");
        for (var field : mixin.fields) {
            assertTrue(target.fields.stream().anyMatch(candidate -> candidate.name.equals(field.name)
                    && candidate.desc.equals(field.desc)), field.name + " must match exact game field");
        }
        assertTrue(target.methods.stream().anyMatch(method -> method.name.equals("updateCommandInfo") && method.desc.equals("()V")));
        assertTrue(target.methods.stream().anyMatch(method -> method.name.equals("showSuggestions") && method.desc.equals("(Z)V")));
        var injected = mixin.methods.stream().filter(method -> method.name.contains("automaticMentions")).findFirst().orElseThrow();
        AnnotationNode annotation = injected.visibleAnnotations.stream().filter(value -> value.desc.endsWith("/Inject;")).findFirst().orElseThrow();
        assertEquals(List.of("updateCommandInfo"), value(annotation, "method"));
        for (var instruction : injected.instructions) {
            if (instruction instanceof MethodInsnNode call) assertFalse(call.owner.contains("Networking") || call.name.startsWith("send"));
        }
    }

    private static Object value(AnnotationNode annotation, String key) {
        for (int index = 0; index < annotation.values.size(); index += 2) {
            if (annotation.values.get(index).equals(key)) return annotation.values.get(index + 1);
        }
        return null;
    }

    private static ClassNode read(String name) throws IOException {
        try (InputStream input = ChatMixinContractTest.class.getResourceAsStream("/" + name + ".class")) {
            assertNotNull(input, name);
            ClassNode node = new ClassNode();
            new ClassReader(input).accept(node, 0);
            return node;
        }
    }
}
