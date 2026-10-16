package dev.servertradeassistant.fabric.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import dev.servertradeassistant.fabric.network.EntityLabelPermissionPayload;

public final class ServerTradeAssistantClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ClientPlayNetworking.registerGlobalReceiver(EntityLabelPermissionPayload.TYPE,
                (payload, context) -> context.client().execute(
                        () -> EntityIdOverlay.setAllowed(payload.allowed())));
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> EntityIdOverlay.reset());

        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) ->
                dispatcher.register(ClientCommands.literal("entityids")
                        .then(ClientCommands.literal("show").executes(context -> {
                            if (!EntityIdOverlay.allowed()) {
                                context.getSource().sendError(Component.literal(
                                        "Your server role does not allow entity labels."));
                                return 0;
                            }
                            EntityIdOverlay.setRequested(true);
                            context.getSource().sendFeedback(Component.literal(
                                    "Nearby entity IDs are now visible.").withStyle(ChatFormatting.GREEN));
                            return 1;
                        }))
                        .then(ClientCommands.literal("hide").executes(context -> {
                            EntityIdOverlay.setRequested(false);
                            context.getSource().sendFeedback(Component.literal(
                                    "Entity IDs are now hidden.").withStyle(ChatFormatting.GRAY));
                            return 1;
                        }))));
    }
}
