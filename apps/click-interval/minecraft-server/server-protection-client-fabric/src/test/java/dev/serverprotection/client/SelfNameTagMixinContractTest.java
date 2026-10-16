package dev.serverprotection.client;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.AnnotationNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

import static org.junit.jupiter.api.Assertions.*;

/** Verifies the real 26.2 renderer path without bootstrapping or attaching to a Minecraft client. */
final class SelfNameTagMixinContractTest {
    private static final String METHOD = "shouldShowName(Lnet/minecraft/world/entity/LivingEntity;D)Z";
    private static final String CAMERA = "Lnet/minecraft/client/Minecraft;getCameraEntity()Lnet/minecraft/world/entity/Entity;";

    @Test void expressionHookTargetsOnlyTheExistingCameraExclusion() throws IOException {
        var vanilla = method(read("net/minecraft/client/renderer/entity/LivingEntityRenderer"), METHOD);
        assertEquals(1, calls(vanilla, "net/minecraft/client/Minecraft", "getCameraEntity"));
        assertEquals(1, calls(vanilla, "net/minecraft/client/gui/Hud", "isHidden"));
        assertEquals(1, calls(vanilla, "net/minecraft/world/entity/LivingEntity", "isDiscrete"));
        assertEquals(1, calls(vanilla, "net/minecraft/world/entity/LivingEntity", "isInvisibleTo"));
        assertEquals(1, calls(vanilla, "net/minecraft/world/entity/LivingEntity", "isVehicle"));
        var mixin = read("dev/serverprotection/client/mixin/SelfNameTagMixin");
        var hook = mixin.methods.stream().filter(value -> value.name.contains("allowOwnThirdPersonName")).findFirst().orElseThrow();
        assertEquals("(Lnet/minecraft/world/entity/Entity;Lnet/minecraft/world/entity/LivingEntity;D)Lnet/minecraft/world/entity/Entity;", hook.desc);
        var annotation = hook.visibleAnnotations.stream().filter(value -> value.desc.endsWith("/ModifyExpressionValue;")).findFirst().orElseThrow();
        assertEquals(List.of(METHOD), value(annotation, "method"));
        Object atValue = value(annotation, "at");
        AnnotationNode at = atValue instanceof List<?> values ? (AnnotationNode) values.getFirst() : (AnnotationNode) atValue;
        assertEquals("INVOKE", value(at, "value"));
        assertEquals(CAMERA, value(at, "target"));
        assertEquals(1, calls(hook, "dev/serverprotection/client/SelfNameTagPolicy", "allowCameraBypass"));
        assertEquals(1, calls(hook, "net/minecraft/client/CameraType", "isFirstPerson"));
        assertEquals(1, calls(hook, "net/minecraft/client/player/LocalPlayer", "isSpectator"));
        assertEquals(1, calls(hook, "dev/serverprotection/client/IrisShadowPass", "isActive"));
    }

    @Test void avatarAndNativeFormattedNamePipelineAreUnmodified() throws IOException {
        var avatar = method(read("net/minecraft/client/renderer/entity/player/AvatarRenderer"),
                "shouldShowName(Lnet/minecraft/world/entity/Avatar;D)Z");
        assertEquals(1, calls(avatar, "net/minecraft/client/renderer/entity/LivingEntityRenderer", "shouldShowName"));
        assertEquals(1, calls(avatar, "net/minecraft/world/entity/Avatar", "shouldShowName"));
        var nativeTag = method(read("net/minecraft/client/renderer/entity/EntityRenderer"),
                "getNameTag(Lnet/minecraft/world/entity/Entity;)Lnet/minecraft/network/chat/Component;");
        assertEquals(1, calls(nativeTag, "net/minecraft/world/entity/Entity", "getDisplayName"));
        var display = method(read("net/minecraft/world/entity/player/Player"),
                "getDisplayName()Lnet/minecraft/network/chat/Component;");
        assertEquals(1, calls(display, "net/minecraft/world/scores/PlayerTeam", "formatNameForTeam"));
        var extract = method(read("net/minecraft/client/renderer/entity/EntityRenderer"),
                "extractNameTags(Lnet/minecraft/world/entity/Entity;Lnet/minecraft/client/renderer/entity/state/EntityRenderState;FDD)V");
        assertEquals(1, calls(extract, "net/minecraft/client/renderer/entity/EntityRenderer", "getNameTag"));
        assertEquals(1, calls(extract, "net/minecraft/client/renderer/entity/EntityRenderer", "shouldShowName"));
    }

    @Test void featureHasNoNetworkingNoHudOverlayAndNoPerFrameFileAccess() throws IOException {
        for (String name : List.of("SelfNameTagClient", "SelfNameTagPolicy", "mixin/SelfNameTagMixin")) {
            for (var method : read("dev/serverprotection/client/" + name).methods) {
                for (var instruction : method.instructions) {
                    if (instruction instanceof MethodInsnNode call) {
                        assertFalse(call.owner.contains("Networking") || call.name.equals("sendCommand")
                                || call.owner.contains("HudRender") || call.owner.contains("GuiGraphics"), call.owner + "." + call.name);
                        if (name.contains("Mixin") || name.contains("Policy")) {
                            assertFalse(call.owner.startsWith("java/nio/file/") || call.owner.startsWith("java/lang/reflect/"));
                        }
                    }
                }
            }
        }
    }

    private static long calls(MethodNode method, String owner, String name) {
        long found = 0;
        for (var instruction : method.instructions) {
            if (instruction instanceof MethodInsnNode call && call.owner.equals(owner) && call.name.equals(name)) found++;
        }
        return found;
    }
    private static MethodNode method(ClassNode type, String nameAndDescriptor) {
        return type.methods.stream().filter(value -> (value.name + value.desc).equals(nameAndDescriptor)).findFirst().orElseThrow();
    }
    private static Object value(AnnotationNode annotation, String key) {
        for (int index = 0; index < annotation.values.size(); index += 2) {
            if (annotation.values.get(index).equals(key)) return annotation.values.get(index + 1);
        }
        return null;
    }
    private static ClassNode read(String name) throws IOException {
        try (InputStream input = SelfNameTagMixinContractTest.class.getResourceAsStream("/" + name + ".class")) {
            assertNotNull(input, name);
            ClassNode node = new ClassNode();
            new ClassReader(input).accept(node, 0);
            return node;
        }
    }
}
