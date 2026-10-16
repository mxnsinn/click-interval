package com.clickinterval.villagertrades.client;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

final class MerchantMixinContractTest {
    @Test void exactMappedNativeScreenAndWidgetContractsExist() throws Exception {
        var merchant = node("net/minecraft/client/gui/screens/inventory/MerchantScreen");
        assertTrue(merchant.fields.stream().anyMatch(f -> f.name.equals("shopItem") && f.desc.equals("I")));
        assertTrue(merchant.fields.stream().anyMatch(f -> f.name.equals("scrollOff") && f.desc.equals("I")));
        assertTrue(merchant.methods.stream().anyMatch(m -> m.name.equals("init") && m.desc.equals("()V")));
        assertTrue(merchant.methods.stream().anyMatch(m -> m.name.equals("extractContents") && m.desc.equals("(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIF)V")));
        var button = node("net/minecraft/client/gui/components/AbstractButton");
        assertTrue(button.methods.stream().anyMatch(m -> m.name.equals("extractDefaultSprite") && m.desc.equals("(Lnet/minecraft/client/gui/GuiGraphicsExtractor;)V")));
        // Mixins merge into net.minecraft's package; helpers cannot rely on the mixin source package.
        var icon = node("com/clickinterval/villagertrades/client/CycleIconButton");
        assertNotEquals(0, icon.access & org.objectweb.asm.Opcodes.ACC_PUBLIC);
        assertTrue(icon.methods.stream().anyMatch(m -> m.name.equals("<init>") && (m.access & org.objectweb.asm.Opcodes.ACC_PUBLIC) != 0));
    }
    @Test void smallWidgetDoesNotReplaceScreenOrTouchNativeCloseAndStartsHidden() throws Exception {
        String mixin = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/client/MerchantScreenMixin.java"));
        assertTrue(mixin.contains("cycleButton.visible = false"));
        assertTrue(mixin.contains("leftPos + imageWidth - 22, topPos + 4"));
        for (String forbidden : new String[] {"onClose", "keyPressed", "setScreen", "openDialog", "sendSystemMessage", "displayClientMessage"})
            assertFalse(mixin.contains(forbidden), forbidden);
        String button = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/client/CycleIconButton.java"));
        assertTrue(button.contains("18, 18")); assertTrue(button.contains("DEFAULT_NARRATION"));
        assertFalse(button.contains("↻"), "icon does not rely on an optional font glyph");
    }
    @Test void standaloneClientRegistersBothCodecsBeforeReceiverAndHasNoServerDependency() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/client/VillagerTradesClient.java"));
        int receiver = source.indexOf("ClientPlayNetworking.registerGlobalReceiver");
        assertTrue(receiver >= 0);
        assertTrue(source.indexOf("PayloadTypeRegistry.serverboundPlay().register") >= 0);
        assertTrue(source.indexOf("PayloadTypeRegistry.clientboundPlay().register") >= 0);
        assertTrue(source.indexOf("PayloadTypeRegistry.serverboundPlay().register") < receiver);
        assertTrue(source.indexOf("PayloadTypeRegistry.clientboundPlay().register") < receiver);
        assertTrue(source.contains("context.client().gui.screen()"));
        try (var sources = Files.walk(Path.of("src/main/java/com/clickinterval/villagertrades/client"))) {
            for (var file : sources.filter(p -> p.toString().endsWith(".java")).toList()) {
                String client = Files.readString(file);
                assertFalse(client.contains("import com.clickinterval.villagertrades.CyclePolicy"));
                assertFalse(client.contains("import com.clickinterval.villagertrades.TradeCycling"));
                assertFalse(client.contains("import com.clickinterval.villagertrades.ServerVillagerTrades"));
            }
        }
    }
    @Test void reinitAndEveryNativeRenderRefreshVisibilityButNetworkRetriesAreStateGated() throws Exception {
        var mixin = node("com/clickinterval/villagertrades/client/MerchantScreenMixin");
        for (String name : new String[] {"clickInterval$addCycleButton", "clickInterval$updateButton", "clickInterval$acceptCycleStatus"}) {
            var method = mixin.methods.stream().filter(m -> m.name.equals(name)).findFirst().orElseThrow();
            assertTrue(java.util.Arrays.stream(method.instructions.toArray()).anyMatch(i ->
                    i instanceof org.objectweb.asm.tree.MethodInsnNode call && call.name.equals("clickInterval$refreshButton")), name);
        }
        String source = Files.readString(Path.of("src/main/java/com/clickinterval/villagertrades/client/MerchantScreenMixin.java"));
        assertTrue(source.contains("if (clickInterval$state == null) clickInterval$state = new CycleButtonState(menu.containerId)"));
        assertTrue(source.contains("clickInterval$state.queryIfDue(supported,"));
        assertTrue(source.contains("new CycleRequest(menu.containerId, 0, false)"));
        assertFalse(source.contains("queryOnce"));
    }
    private ClassNode node(String name) throws Exception {
        try (var stream = getClass().getClassLoader().getResourceAsStream(name + ".class")) {
            assertNotNull(stream); var node = new ClassNode(); new ClassReader(stream).accept(node, 0); return node;
        }
    }
}
