package dev.custominchat.client;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;
import static org.junit.jupiter.api.Assertions.*;

class ArtifactContractTest {
    private static final String PACKAGE = "dev/custominchat/client/";

    private ZipFile artifact() throws Exception { return new ZipFile(Path.of(System.getProperty("client.releaseJar")).toFile()); }
    private byte[] bytes(ZipFile zip, String entry) throws Exception {
        assertNotNull(zip.getEntry(entry), entry);
        try (var stream = zip.getInputStream(zip.getEntry(entry))) { return stream.readAllBytes(); }
    }
    private JsonObject json(ZipFile zip, String entry) throws Exception {
        return JsonParser.parseString(new String(bytes(zip, entry), StandardCharsets.UTF_8)).getAsJsonObject();
    }
    private ClassNode readClass(ZipFile zip, String name) throws Exception {
        ClassNode node = new ClassNode();
        new ClassReader(bytes(zip, PACKAGE + name + ".class")).accept(node, 0);
        return node;
    }
    private List<MethodInsnNode> calls(ClassNode node) {
        List<MethodInsnNode> calls = new ArrayList<>();
        node.methods.forEach(method -> method.instructions.forEach(instruction -> {
            if (instruction instanceof MethodInsnNode call) calls.add(call);
        }));
        return calls;
    }

    @Test void exactBrandVersionAndOnlyPortableRequiredDependencies() throws Exception {
        try (ZipFile zip = artifact()) {
            JsonObject descriptor = json(zip, "fabric.mod.json");
            assertEquals("Custom In-Chat Client", descriptor.get("name").getAsString());
            assertEquals("custom_in_chat_client", descriptor.get("id").getAsString());
            assertEquals("1.0.0", descriptor.get("version").getAsString());
            assertEquals("client", descriptor.get("environment").getAsString());
            assertEquals(Set.of("fabricloader", "minecraft", "java", "fabric-api"), descriptor.getAsJsonObject("depends").keySet());
            assertEquals("26.2", descriptor.getAsJsonObject("depends").get("minecraft").getAsString());
            assertEquals(Set.of("modmenu"), descriptor.getAsJsonObject("suggests").keySet());
            assertEquals(Set.of("client", "modmenu"), descriptor.getAsJsonObject("entrypoints").keySet());
            assertFalse(descriptor.has("mixins"));
            assertFalse(descriptor.has("jars"));
            assertTrue(descriptor.get("description").getAsString().contains("Requires a world or server"));
        }
    }

    @Test void brandedIconIsRealSquareTransparentPng() throws Exception {
        try (ZipFile zip = artifact()) {
            var descriptor = json(zip, "fabric.mod.json");
            byte[] png = bytes(zip, descriptor.get("icon").getAsString());
            assertEquals((byte) 0x89, png[0]);
            assertEquals("PNG", new String(png, 1, 3, StandardCharsets.US_ASCII));
            var image = ImageIO.read(new ByteArrayInputStream(png));
            assertNotNull(image);
            assertEquals(image.getWidth(), image.getHeight());
            assertTrue(image.getWidth() >= 64 && image.getWidth() <= 512);
            assertTrue(image.getColorModel().hasAlpha());
            boolean transparent = false, visible = false;
            for (int y = 0; y < image.getHeight(); y++) for (int x = 0; x < image.getWidth(); x++) {
                int alpha = image.getRGB(x, y) >>> 24;
                transparent |= alpha == 0;
                visible |= alpha > 200;
            }
            assertTrue(transparent && visible);
        }
    }

    @Test void everyUserFacingBindingHasTranslationAndNoExtraSettingsFile() throws Exception {
        try (ZipFile zip = artifact()) {
            JsonObject language = json(zip, "assets/custom_in_chat_client/lang/en_us.json");
            assertEquals("Custom In-Chat Client", language.get("key.category.custom_in_chat_client.enchantments").getAsString());
            for (EnchantmentAction action : EnchantmentAction.values()) {
                assertTrue(language.has(action.translationKey()), action.name());
                assertFalse(language.get(action.translationKey()).getAsString().isBlank());
            }
            assertTrue(language.has("message.custom_in_chat_client.unsupported"));
        }
    }

    @Test void shippedClassesContainNoLocalPathsOrExternalClientDependencies() throws Exception {
        Pattern drivePath = Pattern.compile("[A-Za-z]:[\\\\/]");
        try (ZipFile zip = artifact()) {
            for (var entries = zip.entries(); entries.hasMoreElements();) {
                var entry = entries.nextElement();
                assertFalse(entry.getName().contains(".."));
                if (!entry.getName().endsWith(".class") && !entry.getName().endsWith(".json")) continue;
                byte[] content = bytes(zip, entry.getName());
                String raw = new String(content, StandardCharsets.ISO_8859_1);
                assertFalse(drivePath.matcher(raw).find(), entry.getName());
                for (String forbidden : List.of("\\\\", "/users/", "/home/", "file:/", "lunar", "serverprotection", "solotest")) {
                    assertFalse(raw.toLowerCase(Locale.ROOT).contains(forbidden), entry.getName() + " contains " + forbidden);
                }
                if (entry.getName().endsWith(".class")) {
                    assertTrue(entry.getName().startsWith(PACKAGE), entry.getName());
                    assertEquals(69, new ClassReader(content).readUnsignedShort(6));
                }
            }
        }
    }

    @Test void runtimeWiresSafetyGuardsAndUsesOnlyOrdinarySelfCommandTransport() throws Exception {
        try (ZipFile zip = artifact()) {
            ClassNode client = readClass(zip, "CustomInChatClient");
            List<MethodInsnNode> instructions = calls(client);
            for (String required : List.of("screen", "isWindowActive", "consumeClick", "getCommands", "sendCommand", "sendSystemMessage")) {
                assertTrue(instructions.stream().anyMatch(call -> call.name.equals(required)), required);
            }
            for (String required : List.of("eligible", "request")) {
                assertTrue(instructions.stream().anyMatch(call -> call.owner.equals(PACKAGE + "CommandPolicy") && call.name.equals(required)), required);
            }
            assertTrue(instructions.stream().anyMatch(call -> call.owner.equals(PACKAGE + "PressGate") && call.name.equals("accept")));
            assertTrue(instructions.stream().anyMatch(call -> call.owner.equals(PACKAGE + "CommandTreeSupport") && call.name.equals("supports")));
            assertTrue(instructions.stream().anyMatch(call -> call.owner.equals("net/minecraft/client/multiplayer/ClientPacketListener") && call.name.equals("sendCommand")));
            for (MethodInsnNode call : instructions) {
                assertFalse(call.owner.contains("terraformersmc"), "Optional integration linked from core");
                assertFalse(call.owner.startsWith("java/io/") || call.owner.startsWith("java/nio/file/") || call.owner.startsWith("java/net/"), call.owner);
                assertFalse(call.owner.startsWith("net/minecraft/server/"), call.owner);
                assertFalse(call.name.equals("sendChat") || call.name.equals("sendChatMessage") || call.name.equals("setScreen"), call.name);
            }
            ClassNode integration = readClass(zip, "OptionalModMenuIntegration");
            assertTrue(integration.interfaces.contains("com/terraformersmc/modmenu/api/ModMenuApi"));
            assertTrue(calls(integration).stream().anyMatch(call -> call.owner.endsWith("/KeyBindsScreen") && call.getOpcode() == Opcodes.INVOKESPECIAL));
        }
    }
}
