package dev.serverprotection.client;

import java.io.IOException;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.network.chat.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Local-only preference and command. No server permission, packet, tick handler, or remote state. */
public final class SelfNameTagClient {
    private static final Logger LOGGER = LoggerFactory.getLogger("serverprotection_companion");
    private static SelfNameTagSettings settings;

    private SelfNameTagClient() {}
    public static boolean enabled() { return settings != null && settings.enabled(); }

    static void register() {
        settings = new SelfNameTagSettings(FabricLoader.getInstance().getConfigDir()
                .resolve("serverprotection-companion-self-nametag.properties"));
        try { settings.load(); }
        catch (IOException failure) { LOGGER.warn("Own-nametag preference could not be read; disabled until /selfnametag on."); }
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registry) ->
                dispatcher.register(ClientCommands.literal("selfnametag")
                        .executes(context -> status(context.getSource()))
                        .then(ClientCommands.literal("status").executes(context -> status(context.getSource())))
                        .then(ClientCommands.literal("on").executes(context -> set(context.getSource(), true)))
                        .then(ClientCommands.literal("off").executes(context -> set(context.getSource(), false)))
                        .then(ClientCommands.literal("toggle").executes(context -> set(context.getSource(), !enabled())))));
    }

    private static int status(FabricClientCommandSource source) {
        source.sendFeedback(Component.literal("Show my nametag: " + (enabled() ? "ON" : "OFF")
                + " (third person only). /selfnametag on|off|toggle"));
        return 1;
    }

    private static int set(FabricClientCommandSource source, boolean requested) {
        try {
            settings.setEnabled(requested);
            return status(source);
        } catch (IOException failure) {
            source.sendError(Component.literal("Could not save the nametag preference; the previous setting is unchanged."));
            return 0;
        }
    }
}
