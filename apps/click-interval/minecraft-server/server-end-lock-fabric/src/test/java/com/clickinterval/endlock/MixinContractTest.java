package com.clickinterval.endlock;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import java.io.InputStream;
import static org.junit.jupiter.api.Assertions.*;

final class MixinContractTest {
    @Test void targetsActualCraftingLookupCacheAndStaleOutputMethods() throws Exception {
        method("world/item/crafting/RecipeManager", "getRecipeFor", "(Lnet/minecraft/world/item/crafting/RecipeType;Lnet/minecraft/world/item/crafting/RecipeInput;Lnet/minecraft/world/level/Level;)Ljava/util/Optional;");
        method("world/item/crafting/RecipeManager", "getRecipeFor", "(Lnet/minecraft/world/item/crafting/RecipeType;Lnet/minecraft/world/item/crafting/RecipeInput;Lnet/minecraft/world/level/Level;Lnet/minecraft/world/item/crafting/RecipeHolder;)Ljava/util/Optional;");
        method("world/level/block/CrafterBlock", "getPotentialResults", "(Lnet/minecraft/server/level/ServerLevel;Lnet/minecraft/world/item/crafting/CraftingInput;)Ljava/util/Optional;");
        method("world/inventory/Slot", "mayPickup", "(Lnet/minecraft/world/entity/player/Player;)Z");
        method("world/inventory/ResultSlot", "remove", "(I)Lnet/minecraft/world/item/ItemStack;");
        method("world/inventory/ResultSlot", "safeClone", "(Lnet/minecraft/world/entity/player/Player;)Lnet/minecraft/world/item/ItemStack;");
        for (String menu : new String[]{"CraftingMenu", "InventoryMenu"}) method("world/inventory/" + menu,
                "quickMoveStack", "(Lnet/minecraft/world/entity/player/Player;I)Lnet/minecraft/world/item/ItemStack;");
    }

    @Test void targetsRealPortalAndBothCovariantTeleportImplementations() throws Exception {
        method("world/item/EnderEyeItem", "useOn", "(Lnet/minecraft/world/item/context/UseOnContext;)Lnet/minecraft/world/InteractionResult;");
        method("world/level/block/EndPortalBlock", "getPortalDestination", "(Lnet/minecraft/server/level/ServerLevel;Lnet/minecraft/world/entity/Entity;Lnet/minecraft/core/BlockPos;)Lnet/minecraft/world/level/portal/TeleportTransition;");
        method("world/entity/Entity", "teleport", "(Lnet/minecraft/world/level/portal/TeleportTransition;)Lnet/minecraft/world/entity/Entity;");
        method("server/level/ServerPlayer", "teleport", "(Lnet/minecraft/world/level/portal/TeleportTransition;)Lnet/minecraft/server/level/ServerPlayer;");
        assertTrue(read("commands/CommandSourceStack").fields.stream().anyMatch(field -> field.name.equals("source")
                && field.desc.equals("Lnet/minecraft/commands/CommandSource;")));
    }

    @Test void hostGuardUsesActualServerProfileSourceAndPermissionApis() throws Exception {
        method("server/MinecraftServer", "getSingleplayerProfile", "()Lcom/mojang/authlib/GameProfile;");
        method("server/MinecraftServer", "isSingleplayerOwner", "(Lnet/minecraft/server/players/NameAndId;)Z");
        method("server/MinecraftServer", "isDedicatedServer", "()Z");
        method("server/level/ServerPlayer", "commandSource", "()Lnet/minecraft/commands/CommandSource;");
        method("server/level/ServerPlayer", "permissions", "()Lnet/minecraft/server/permissions/PermissionSet;");
    }

    @Test void targetsActualNetherIgnitionPortalAndPlayerAwareCraftingMethods() throws Exception {
        method("world/level/portal/PortalShape", "createPortalBlocks", "(Lnet/minecraft/world/level/LevelAccessor;)V");
        method("world/level/block/NetherPortalBlock", "getPortalDestination", "(Lnet/minecraft/server/level/ServerLevel;Lnet/minecraft/world/entity/Entity;Lnet/minecraft/core/BlockPos;)Lnet/minecraft/world/level/portal/TeleportTransition;");
        method("world/inventory/CraftingMenu", "slotChangedCraftingGrid", "(Lnet/minecraft/world/inventory/AbstractContainerMenu;Lnet/minecraft/server/level/ServerLevel;Lnet/minecraft/world/entity/player/Player;Lnet/minecraft/world/inventory/CraftingContainer;Lnet/minecraft/world/inventory/ResultContainer;Lnet/minecraft/world/item/crafting/RecipeHolder;)V");
        method("server/level/ServerChunkCache", "getChunkNow", "(II)Lnet/minecraft/world/level/chunk/LevelChunk;");
    }

    @Test void vanillaOriginAndEarlyDamageProtectionTargetActualServerPlayer() throws Exception {
        assertTrue(read("server/level/ServerPlayer").fields.stream().anyMatch(field -> field.name.equals("enteredNetherPosition")
                && field.desc.equals("Lnet/minecraft/world/phys/Vec3;")));
        method("server/level/ServerPlayer", "hurtServer", "(Lnet/minecraft/server/level/ServerLevel;Lnet/minecraft/world/damagesource/DamageSource;F)Z");
    }

    private static void method(String owner, String name, String descriptor) throws Exception {
        assertTrue(read(owner).methods.stream().anyMatch(method -> method.name.equals(name) && method.desc.equals(descriptor)), owner + "." + name + descriptor);
    }
    private static ClassNode read(String name) throws Exception {
        try (InputStream input = MixinContractTest.class.getResourceAsStream("/net/minecraft/" + name + ".class")) {
            assertNotNull(input);
            ClassNode node = new ClassNode();
            new ClassReader(input).accept(node, 0);
            return node;
        }
    }
}
