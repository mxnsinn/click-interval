package com.clickinterval.solotest;

import java.util.*;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.*;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.commands.*;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;

/** Native settings for the explicitly opened, host-owned solo test world only. */
final class TestSettingsScreen extends Screen {
    private final MinecraftServer server;
    private final UUID host;
    private final Map<String,String> status=new HashMap<>();
    private final Map<String,String> durations=new HashMap<>();
    private String feedback="Timers use real time and persist across world restarts.";
    private volatile boolean active=true;
    private int ticks,left,panelWidth;
    TestSettingsScreen(MinecraftServer server,UUID host) {
        super(Component.literal("Test world dimension settings")); this.server=server; this.host=host;
    }
    static void registerFeedback() {
        ClientReceiveMessageEvents.ALLOW_GAME.register((message,overlay)-> {
            var client=Minecraft.getInstance();
            if(!overlay && client.gui.screen() instanceof TestSettingsScreen screen && screen.current()) {
                String text=message.getString();
                if(text.startsWith("End:") || text.startsWith("Nether:")) {
                    screen.accept(text.startsWith("End:")?"endlock":"netherlock",true,text);
                    return false; // Render the polled status in this panel, without filling chat history.
                }
                if(text.startsWith("End ") || text.startsWith("Nether ")) {
                    screen.accept(text.startsWith("End ")?"endlock":"netherlock",false,text);
                }
            }
            return true; // Other messages and authoritative mutation feedback remain in chat.
        });
    }
    @Override protected void init() {
        active=true; left=Math.max(8,width/2-210); panelWidth=Math.min(420,width-16);
        row("endlock",66); row("netherlock",142);
        addRenderableWidget(Button.builder(Component.literal("Done"),button->onClose()).bounds(left+panelWidth-80,height-26,80,20).build());
        refresh();
    }
    private void row(String target,int y) {
        int buttonWidth=Math.max(42,Math.min(72,(panelWidth-112)/3)),applyWidth=90,fieldWidth=panelWidth-buttonWidth*2-applyWidth-12;
        addRenderableWidget(Button.builder(Component.literal("Lock"),button->dispatch(target,"on",null,false)).bounds(left,y,buttonWidth,20).build());
        addRenderableWidget(Button.builder(Component.literal("Unlock"),button->dispatch(target,"off",null,false)).bounds(left+buttonWidth+4,y,buttonWidth,20).build());
        EditBox duration=new EditBox(font,left+buttonWidth*2+8,y,fieldWidth,20,Component.literal(target.equals("endlock")?"End lock duration":"Nether lock duration"));
        duration.setMaxLength(10); duration.setValue(durations.getOrDefault(target,"1d"));
        duration.setResponder(value->durations.put(target,value));
        duration.setTooltip(Tooltip.create(Component.literal("Real time: 30s, 10m, 2h, 1d. From 1 second to 365 days.")));
        addRenderableWidget(duration);
        addRenderableWidget(Button.builder(Component.literal("Apply timer"),button->dispatch(target,"for",duration.getValue(),false)).bounds(left+panelWidth-applyWidth,y,applyWidth,20).build());
    }
    private boolean current() {
        return active && minecraft!=null && minecraft.level!=null && minecraft.getSingleplayerServer()==server && minecraft.player!=null && host.equals(minecraft.player.getUUID());
    }
    private void refresh() {
        dispatch("endlock","status",null,true); dispatch("netherlock","status",null,true);
    }
    @Override public void tick() {
        if(!current()) { onClose(); return; }
        if(++ticks%20==0) refresh();
    }
    private void dispatch(String target,String action,String duration,boolean statusOnly) {
        if(!current()) return;
        final String command;
        try { command=LockDispatch.command(target,action,duration); }
        catch(IllegalArgumentException invalid) { feedback=invalid.getMessage(); return; }
        if(!statusOnly) feedback="Applying "+command+"…";
        // Existing native command parser and the real player's permission set are authoritative.
        server.execute(()-> {
            if(!active || server!=Minecraft.getInstance().getSingleplayerServer()) return;
            var player=server.getPlayerList().getPlayer(host);
            if(player==null) return;
            CommandSourceStack original=player.createCommandSourceStack();
            if(!TestHub.permitted(original)) { accept(target,false,"Settings require the host with cheats enabled in TreeChopTest or marked TestWorld."); return; }
            if(server.getCommands().getDispatcher().getRoot().getChild(target)==null) {
                accept(target,statusOnly,"This dimension lock command is not installed."); return;
            }
            // Do not replace source identity: the lock mod also authenticates player.commandSource().
            try { server.getCommands().performPrefixedCommand(original.withCallback((success,result)-> {
                if(!success) accept(target,statusOnly,"Command rejected. The native error remains in chat.");
            }),command); }
            catch(RuntimeException failure) { accept(target,statusOnly,"Command failed: "+failure.getClass().getSimpleName()); }
        });
    }
    private void accept(String target,boolean statusOnly,String message) {
        Minecraft.getInstance().execute(()-> {
            if(!current()) return;
            String bounded=message.length()>350?message.substring(0,350):message;
            if(statusOnly) status.put(target,bounded); else feedback=bounded;
        });
    }
    @Override public void extractRenderState(GuiGraphicsExtractor graphics,int mouseX,int mouseY,float delta) {
        super.extractRenderState(graphics,mouseX,mouseY,delta);
        graphics.centeredText(font,title,width/2,10,0xFFFFFFFF);
        drawStatus(graphics,"End","endlock",30); drawStatus(graphics,"Nether","netherlock",106);
        graphics.text(font,"Lock is indefinite. Timers unlock automatically.",left,173,0xFFCCCCCC);
        var lines=font.split(Component.literal(feedback),panelWidth);
        int maxLines=Math.max(0,Math.min(3,(height-218)/10));
        for(int index=0;index<Math.min(maxLines,lines.size());index++) graphics.text(font,lines.get(index),left,189+index*10,0xFFFFE5A0);
    }
    private void drawStatus(GuiGraphicsExtractor graphics,String label,String target,int y) {
        graphics.text(font,label,left,y,0xFFFFFFFF);
        var lines=font.split(Component.literal(status.getOrDefault(target,"Reading current settings…")),panelWidth);
        for(int index=0;index<Math.min(2,lines.size());index++) graphics.text(font,lines.get(index),left,y+12+index*10,0xFFB7DEC8);
    }
    @Override public void removed() { active=false; }
    @Override public void onClose() { active=false; if(minecraft!=null && minecraft.gui.screen()==this) minecraft.gui.setScreen(null); }
    @Override public boolean isPauseScreen() { return false; }
}
