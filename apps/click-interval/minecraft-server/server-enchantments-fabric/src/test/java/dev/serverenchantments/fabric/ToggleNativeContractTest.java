package dev.serverenchantments.fabric;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;
import java.io.InputStream;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

final class ToggleNativeContractTest {
    @Test void togglePathsNeverRewriteNativeItemsOrEnchantments() throws Exception {
        for (String name : new String[]{"ServerEnchantmentsFabric", "PlayerToggleStore", "EnchantmentToggleMenu", "mixin/EnchantmentToggleInputMixin"}) {
            ClassNode node = read("dev/serverenchantments/fabric/" + name);
            for (var method : node.methods) for (var instruction : method.instructions)
                if (instruction instanceof MethodInsnNode call) {
                    assertNotEquals("setItemInHand", call.name);
                    assertNotEquals("setDamageValue", call.name);
                    assertNotEquals("setEnchantments", call.name);
                    assertNotEquals("updateEnchantments", call.name);
                    assertFalse(call.owner.startsWith("net/minecraft/client/"));
                }
        }
    }
    @Test void preferenceChecksGuardNewWorkQueuedWorkReplantAndImmatureCropProtection() throws Exception {
        String source = Files.readString(Path.of("src/main/java/dev/serverenchantments/fabric/ServerEnchantmentsFabric.java"));
        assertTrue(source.contains("enabled(job.player, job.feature())"));
        assertTrue(source.contains("if (job != null && job.feature() == feature)"));
        assertTrue(source.contains("successful && eligible(player) && enabled(player, PlayerToggleStore.Feature.HARVESTER)"));
        assertTrue(source.contains("return !enabled(serverPlayer, PlayerToggleStore.Feature.HARVESTER)"));
        assertTrue(source.contains("server-market-test-fixture"));
        String hooks = Files.readString(Path.of("src/main/java/dev/serverenchantments/fabric/mixin/EnchantmentToggleInputMixin.java"));
        assertTrue(hooks.contains("ensureRunningOnSameThread"));
        assertTrue(hooks.contains("shift = At.Shift.AFTER"));
        assertTrue(hooks.contains("packet.stateId() != player.containerMenu.getStateId()"));
    }
    private ClassNode read(String path) throws Exception {
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream(path + ".class")) {
            assertNotNull(stream); ClassNode node = new ClassNode(); new ClassReader(stream).accept(node, 0); return node;
        }
    }
}
