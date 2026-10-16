package dev.serverprotection.client;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AnnotationNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.TypeInsnNode;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** Inspect the compiled optional mixin without requiring Sodium or a graphics context. */
final class SodiumPlayerVisibilityCompatibilityTest {
    @Test
    void optionalTargetHasNoSodiumDependencyOrBroadVisibilityHook() throws IOException {
        ClassNode node = readMixin();
        List<AnnotationNode> annotations = annotations(node.visibleAnnotations, node.invisibleAnnotations);
        assertNotNull(annotation(annotations, "Lorg/spongepowered/asm/mixin/Pseudo;"));
        AnnotationNode mixin = annotation(annotations, "Lorg/spongepowered/asm/mixin/Mixin;");
        assertEquals(List.of("net.caffeinemc.mods.sodium.client.render.SodiumWorldRenderer"), value(mixin, "targets"));
        assertEquals(false, value(mixin, "remap"));
        assertEquals("java/lang/Object", node.superName);
    }

    @Test
    void exact26_2And26_3DescriptorsAreOptionalAndCancelOnlyAtOcclusionHead() throws IOException {
        Set<String> methods = new HashSet<>();
        for (MethodNode method : readMixin().methods) {
            AnnotationNode inject = annotation(annotations(method.visibleAnnotations, method.invisibleAnnotations),
                    "Lorg/spongepowered/asm/mixin/injection/Inject;");
            if (inject == null) continue;
            @SuppressWarnings("unchecked") List<String> targets = (List<String>) value(inject, "method");
            methods.addAll(targets);
            assertEquals(0, value(inject, "require"));
            assertEquals(false, value(inject, "remap"));
            assertEquals(true, value(inject, "cancellable"));
            @SuppressWarnings("unchecked") List<AnnotationNode> at = (List<AnnotationNode>) value(inject, "at");
            assertEquals(1, at.size());
            assertEquals("HEAD", value(at.getFirst(), "value"));
        }
        assertEquals(Set.of(
                "isEntityVisible(Lnet/minecraft/client/renderer/entity/EntityRenderer;Lnet/minecraft/world/entity/Entity;)Z",
                "isEntityVisible(Lnet/minecraft/client/renderer/entity/EntityRenderer;Lnet/minecraft/world/entity/Entity;F)Z"), methods);
    }

    @Test
    void bypassIsRestrictedToPlayerTypeWithoutWorldOrOptionsMutation() throws IOException {
        MethodNode gate = readMixin().methods.stream()
                .filter(method -> method.name.equals("serverProtection$preservePlayer")).findFirst().orElseThrow();
        List<String> typeChecks = new ArrayList<>();
        List<String> calls = new ArrayList<>();
        for (var instruction : gate.instructions) {
            if (instruction instanceof TypeInsnNode type && type.getOpcode() == Opcodes.INSTANCEOF) {
                typeChecks.add(type.desc);
            }
            if (instruction instanceof MethodInsnNode call) calls.add(call.owner + "." + call.name);
            assertNotEquals(Opcodes.PUTFIELD, instruction.getOpcode());
            assertNotEquals(Opcodes.PUTSTATIC, instruction.getOpcode());
        }
        assertEquals(List.of("net/minecraft/world/entity/player/Player"), typeChecks);
        assertEquals(List.of("java/lang/Boolean.valueOf",
                "org/spongepowered/asm/mixin/injection/callback/CallbackInfoReturnable.setReturnValue"), calls);
    }

    private static ClassNode readMixin() throws IOException {
        try (InputStream stream = SodiumPlayerVisibilityCompatibilityTest.class.getResourceAsStream(
                "/dev/serverprotection/client/mixin/SodiumPlayerVisibilityMixin.class")) {
            assertNotNull(stream);
            ClassNode node = new ClassNode();
            new ClassReader(stream).accept(node, 0);
            return node;
        }
    }

    private static List<AnnotationNode> annotations(List<AnnotationNode> visible, List<AnnotationNode> invisible) {
        List<AnnotationNode> result = new ArrayList<>();
        if (visible != null) result.addAll(visible);
        if (invisible != null) result.addAll(invisible);
        return result;
    }

    private static AnnotationNode annotation(List<AnnotationNode> annotations, String descriptor) {
        return annotations.stream().filter(node -> node.desc.equals(descriptor)).findFirst().orElse(null);
    }

    private static Object value(AnnotationNode annotation, String key) {
        assertNotNull(annotation);
        for (int index = 0; index < annotation.values.size(); index += 2) {
            if (annotation.values.get(index).equals(key)) return annotation.values.get(index + 1);
        }
        return null;
    }
}
