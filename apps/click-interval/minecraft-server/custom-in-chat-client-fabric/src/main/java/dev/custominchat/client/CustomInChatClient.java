package dev.custominchat.client;

import com.mojang.blaze3d.platform.InputConstants;
import java.util.EnumMap;
import java.util.Map;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

/** Optional, launcher-independent convenience keys. The server owns all enchantment state. */
public final class CustomInChatClient implements ClientModInitializer {
    public static final String MOD_ID = "custom_in_chat_client";
    private final Map<EnchantmentAction, Binding> bindings = new EnumMap<>(EnchantmentAction.class);

    @Override
    public void onInitializeClient() {
        KeyMapping.Category category = KeyMapping.Category.register(
                Identifier.fromNamespaceAndPath(MOD_ID, "enchantments"));
        for (EnchantmentAction action : EnchantmentAction.values()) {
            int defaultKey = action == EnchantmentAction.MENU ? InputConstants.KEY_K : InputConstants.UNKNOWN.getValue();
            KeyMapping mapping = KeyMappingHelper.registerKeyMapping(new KeyMapping(
                    action.translationKey(), InputConstants.Type.KEYSYM, defaultKey, category));
            bindings.put(action, new Binding(mapping, new PressGate()));
        }
        ClientTickEvents.END_CLIENT_TICK.register(this::tick);
    }

    private void tick(Minecraft client) {
        var connection = client.getConnection();
        boolean eligible = CommandPolicy.eligible(client.player != null, client.level != null,
                connection != null, client.gui.screen() != null, client.isWindowActive());
        for (var entry : bindings.entrySet()) {
            Binding binding = entry.getValue();
            boolean queuedPress = false;
            // Drain even in menus, so typing or rebinding cannot queue actions for later.
            while (binding.mapping().consumeClick()) queuedPress = true;
            if (!binding.gate().accept(queuedPress, physicallyDown(client, binding.mapping()), eligible)) continue;
            boolean available = connection != null && CommandTreeSupport.supports(connection.getCommands().getRoot());
            CommandPolicy.request(entry.getKey(), eligible, available,
                    command -> connection.sendCommand(command),
                    () -> client.player.sendSystemMessage(Component.translatable(
                            "message.custom_in_chat_client.unsupported")));
        }
    }

    private static boolean physicallyDown(Minecraft client, KeyMapping mapping) {
        var key = KeyMappingHelper.getBoundKeyOf(mapping);
        if (key.equals(InputConstants.UNKNOWN)) return false;
        // Vanilla clears mapping state on opening a screen; physical state keeps held keys debounced.
        if (key.getType() == InputConstants.Type.MOUSE) {
            return GLFW.glfwGetMouseButton(client.getWindow().handle(), key.getValue()) == GLFW.GLFW_PRESS;
        }
        if (key.getType() == InputConstants.Type.KEYSYM) {
            return InputConstants.isKeyDown(client.getWindow(), key.getValue());
        }
        // Platform-only scancodes have no GLFW keysym; retain vanilla support for those rare keys.
        return mapping.isDown();
    }

    private record Binding(KeyMapping mapping, PressGate gate) {}
}
