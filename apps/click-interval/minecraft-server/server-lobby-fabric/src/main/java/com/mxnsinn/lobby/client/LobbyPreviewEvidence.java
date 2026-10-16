package com.mxnsinn.lobby.client;

import com.google.gson.JsonObject;
import com.mxnsinn.lobby.LobbyPreviewGuard;
import com.mxnsinn.lobby.LobbyScope;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.LoggerFactory;

/** One passive screenshot of an explicitly launched, isolated preview. Never controls input or camera. */
public final class LobbyPreviewEvidence implements ClientModInitializer {
    private static final Path GAME = Path.of("D:/Codex-Projects/OPMouseHotkeyElectron/work/lobby-preview/client");
    private static final Path WORLD = GAME.resolve("saves/MxnsinnLobbyPreview");
    private boolean finished;
    private long readySince;
    @Override public void onInitializeClient() {
        if (!Boolean.getBoolean("mxnsinn.lobby.preview")) return;
        ClientTickEvents.END_CLIENT_TICK.register(this::tick);
    }
    private void tick(Minecraft client) {
        if (finished) return;
        var server = client.getSingleplayerServer();
        if (client.player == null || client.level == null || server == null || !server.isReady()
                || client.gui.screen() != null || client.gui.overlay() != null) { readySince = 0; return; }
        try {
            if (!client.gameDirectory.toPath().toRealPath().equals(GAME.toRealPath())
                    || !server.getWorldPath(LevelResource.ROOT).toRealPath().equals(WORLD.toRealPath())
                    || !LobbyScope.marked(WORLD) || !LobbyPreviewGuard.active(server)) {
                finished = true; return;
            }
            if (readySince == 0) readySince = System.nanoTime();
            if (System.nanoTime() - readySince < 12_000_000_000L) return;
            finished = true;
            long stamp = System.currentTimeMillis();
            String screenshot = "lobby-preview-" + stamp + ".png";
            JsonObject evidence = new JsonObject();
            evidence.addProperty("at", Instant.now().toString());
            evidence.addProperty("integratedWorld", WORLD.toString());
            evidence.addProperty("guardActive", true);
            evidence.addProperty("voiceChatLoaded", FabricLoader.getInstance().isModLoaded("voicechat"));
            evidence.addProperty("x", client.player.getX());
            evidence.addProperty("y", client.player.getY());
            evidence.addProperty("z", client.player.getZ());
            evidence.addProperty("yaw", client.player.getYRot());
            evidence.addProperty("health", client.player.getHealth());
            evidence.addProperty("flying", client.player.getAbilities().flying);
            evidence.addProperty("mayFly", client.player.getAbilities().mayfly);
            evidence.addProperty("desktopInput", false);
            evidence.addProperty("screenshot", GAME.resolve("screenshots").resolve(screenshot).toString());
            Screenshot.grab(client.gameDirectory, screenshot, client.gameRenderer.mainRenderTarget(), 1, result -> {
                try {
                    evidence.addProperty("screenshotResult", result.getString());
                    Files.writeString(GAME.resolve("preview-ready-" + stamp + ".json"), evidence + "\n", StandardOpenOption.CREATE_NEW);
                    LoggerFactory.getLogger("LobbyPreviewGuard").info("LOBBY_PREVIEW_CLIENT_READY: {}", screenshot);
                } catch (Exception failure) {
                    LoggerFactory.getLogger("LobbyPreviewGuard").error("Lobby preview evidence write failed", failure);
                }
            });
        } catch (Exception failure) {
            finished = true;
            LoggerFactory.getLogger("LobbyPreviewGuard").error("Lobby preview evidence stopped safely", failure);
        }
    }
}
