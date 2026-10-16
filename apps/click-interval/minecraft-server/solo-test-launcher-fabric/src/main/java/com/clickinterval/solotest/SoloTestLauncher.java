package com.clickinterval.solotest;

import java.nio.file.*;
import java.time.Instant;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class SoloTestLauncher implements ClientModInitializer {
    private static final Logger LOG=LoggerFactory.getLogger("clickinterval_solotest");
    private boolean checked,finished;
    private long started;
    private RequestProtocol protocol;
    private RequestProtocol.Request request;
    private long candidateReadySince;
    private boolean screenshotStarted;
    @Override public void onInitializeClient() {
        TestHub.register();
        TestSettingsScreen.registerFeedback();
        ClientTickEvents.END_CLIENT_TICK.register(this::tick);
    }
    private void tick(Minecraft client) {
        if(finished) return;
        if(request!=null) { verifyOpen(client); return; }
        if(checked || !client.isGameLoadFinished() || client.gui.overlay()!=null || !(client.gui.screen() instanceof TitleScreen)) return;
        // Inspect once at the first ready title screen. A later request needs a fresh client launch.
        checked=true;
        if(client.level!=null || client.getSingleplayerServer()!=null || client.getConnection()!=null) { finished=true; return; }
        protocol=new RequestProtocol(client.gameDirectory.toPath(),RequestProtocol.EXPECTED_GAME);
        if(!Files.exists(protocol.requestPath(),LinkOption.NOFOLLOW_LINKS)) { finished=true; return; }
        try {
            request=protocol.consume(client.getLevelSource().getBaseDir(),Instant.now());
            protocol.report(request,"opening","Invoking native existing-world open; no input automation");
            started=System.nanoTime();
            client.createWorldOpenFlows().openWorld(request.world(),()->finish("cancelled","Native world opening cancelled"));
        } catch(Exception failure) {
            LOG.error("SOLO_TEST_OPEN_FAILED: request retained or archived; no retry",failure);
            finish("failed",failure.getClass().getSimpleName());
        }
    }
    private void verifyOpen(Minecraft client) {
        try {
            if(System.nanoTime()-started>180_000_000_000L) {
                finish("failed","Native opening or optional screenshot timed out; screen and world left untouched"); return;
            }
            var server=client.getSingleplayerServer();
            if(client.level!=null && client.player!=null && server!=null && server.isReady()) {
                RequestProtocol.plain(server.getWorldPath(LevelResource.ROOT),true);
                if(!server.getWorldPath(LevelResource.ROOT).toRealPath().equals(protocol.expectedWorld(request.world()).toRealPath())) {
                    finish("failed","Another integrated world opened; left untouched"); return;
                }
                // Revalidate the exact marker even when screenshots are not requested.
                protocol.validateWorld(client.getLevelSource().getBaseDir(),request.world());
                if(request.screenshot()) {
                    if(screenshotStarted) return;
                    if(client.gui.screen()!=null || client.gui.overlay()!=null) { candidateReadySince=0; return; }
                    if(candidateReadySince==0) candidateReadySince=System.nanoTime();
                    if(System.nanoTime()-candidateReadySince<10_000_000_000L) return;
                    protocol.validateWorld(client.getLevelSource().getBaseDir(),request.world());
                    screenshotStarted=true;
                    String name=request.world()+"-"+request.ticket()+".png";
                    Path screenshots=client.gameDirectory.toPath().resolve("screenshots");
                    if(!Files.exists(screenshots,LinkOption.NOFOLLOW_LINKS)) Files.createDirectory(screenshots);
                    RequestProtocol.plain(screenshots,true);
                    if(Files.exists(screenshots.resolve(name),LinkOption.NOFOLLOW_LINKS)) throw new FileAlreadyExistsException(name);
                    Screenshot.grab(client.gameDirectory,name,client.gameRenderer.mainRenderTarget(),1,message->client.execute(()-> {
                        Path output=client.gameDirectory.toPath().resolve("screenshots").resolve(name);
                        finish(Files.isRegularFile(output,LinkOption.NOFOLLOW_LINKS)?"opened":"failed",
                                "Verified integrated "+request.world()+"; native screenshot: "+message.getString());
                    }));
                } else finish("opened","Verified ready integrated "+request.world()+" and local player");
            }
        } catch(Exception failure) { finish("failed",failure.getClass().getSimpleName()); }
    }
    private void finish(String phase,String detail) {
        if(finished) return;
        finished=true;
        if(request!=null) try { protocol.report(request,phase,detail); }
        catch(Exception failure) { LOG.error("Could not record one-shot launch status",failure); }
        LOG.info("SOLO_TEST_OPEN_{}: {}",phase.toUpperCase(java.util.Locale.ROOT),detail);
    }
}
