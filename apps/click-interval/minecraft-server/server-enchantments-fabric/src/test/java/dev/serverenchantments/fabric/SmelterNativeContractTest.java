package dev.serverenchantments.fabric;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;
import java.io.InputStream;
import static org.junit.jupiter.api.Assertions.*;

final class SmelterNativeContractTest {
    @Test void nativeSpawningCallsFortuneResolvedLootExactlyOnceBeforeSeparateExperience() throws Exception {
        ClassNode nativeBlock = read("net/minecraft/world/level/block/Block");
        var method = nativeBlock.methods.stream().filter(candidate -> candidate.name.equals("dropResources")
                && candidate.desc.equals("(Lnet/minecraft/world/level/block/state/BlockState;Lnet/minecraft/world/level/Level;Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/entity/BlockEntity;Lnet/minecraft/world/entity/Entity;Lnet/minecraft/world/item/ItemStack;)V"))
                .findFirst().orElseThrow();
        int lootCalls = 0, experienceCalls = 0;
        for (var instruction : method.instructions) if (instruction instanceof MethodInsnNode call) {
            if (call.name.equals("getDrops")) {
                assertTrue(call.desc.endsWith("Lnet/minecraft/world/item/ItemInstance;)Ljava/util/List;"));
                lootCalls++;
            }
            if (call.name.equals("spawnAfterBreak")) { assertEquals(1, lootCalls); experienceCalls++; }
        }
        assertEquals(1, lootCalls); assertEquals(1, experienceCalls);
    }
    @Test void conversionDoesNotRerollLootSpawnEntitiesOrInventExperience() throws Exception {
        ClassNode smelter = read("dev/serverenchantments/fabric/Smelter");
        for (var method : smelter.methods) for (var instruction : method.instructions)
            if (instruction instanceof MethodInsnNode call) {
                assertNotEquals("getDrops", call.name);
                assertNotEquals("popResource", call.name);
                assertNotEquals("popExperience", call.name);
                assertNotEquals("giveExperiencePoints", call.name);
                assertNotEquals("addFreshEntity", call.name);
                assertNotEquals("getChunk", call.name);
            }
    }
    private ClassNode read(String path) throws Exception {
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream(path + ".class")) {
            assertNotNull(stream); ClassNode node = new ClassNode(); new ClassReader(stream).accept(node, 0); return node;
        }
    }
}
