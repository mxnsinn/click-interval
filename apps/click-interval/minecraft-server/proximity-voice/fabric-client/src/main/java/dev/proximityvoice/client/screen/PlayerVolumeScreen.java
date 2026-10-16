package dev.proximityvoice.client.screen;

import dev.proximityvoice.client.ProximityVoiceClient;
import dev.proximityvoice.client.config.ClientSettings;
import dev.proximityvoice.client.core.VoiceRoster;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.List;

public final class PlayerVolumeScreen extends Screen {
    private static final int PAGE_SIZE = 6;
    private final Screen parent;
    private final ProximityVoiceClient voice;
    private List<ProximityVoiceClient.PlayerView> players = List.of();
    private int page;

    public PlayerVolumeScreen(Screen parent, ProximityVoiceClient voice) {
        super(Component.literal("Player volumes"));
        this.parent = parent;
        this.voice = voice;
    }

    @Override
    protected void init() {
        players = voice.visiblePlayers();
        int pageCount = Math.max(1, (players.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        page = Math.max(0, Math.min(page, pageCount - 1));
        int left = width / 2 - 175;
        int top = Math.max(38, height / 2 - 118);
        int start = page * PAGE_SIZE;
        int end = Math.min(players.size(), start + PAGE_SIZE);
        for (int index = start; index < end; index++) {
            ProximityVoiceClient.PlayerView player = players.get(index);
            int rowY = top + 30 + (index - start) * 28;
            ClientSettings.PlayerAudio playerAudio = voice.settings().playerAudio(player.id());
            addRenderableWidget(Button.builder(Component.literal("−"), button -> changeVolume(player, -0.1))
                    .bounds(left + 177, rowY, 22, 20).build());
            addRenderableWidget(Button.builder(Component.literal("+"), button -> changeVolume(player, 0.1))
                    .bounds(left + 203, rowY, 22, 20).build());
            addRenderableWidget(Button.builder(Component.literal(playerAudio.muted() ? "Unmute" : "Mute"), button -> {
                voice.settings().setPlayerMuted(player.id(), !voice.settings().playerAudio(player.id()).muted());
                voice.settingsChanged(false);
                rebuildWidgets();
            }).bounds(left + 232, rowY, 70, 20).build());
        }
        addRenderableWidget(Button.builder(Component.literal("‹"), button -> {
            page = Math.max(0, page - 1);
            rebuildWidgets();
        }).bounds(left, top + 202, 30, 20).build()).active = page > 0;
        addRenderableWidget(Button.builder(Component.literal("›"), button -> {
            page = Math.min(pageCount - 1, page + 1);
            rebuildWidgets();
        }).bounds(left + 34, top + 202, 30, 20).build()).active = page + 1 < pageCount;
        addRenderableWidget(Button.builder(Component.literal("Back"), button -> onClose())
                .bounds(left + 232, top + 202, 70, 20).build());
    }

    private void changeVolume(ProximityVoiceClient.PlayerView player, double delta) {
        ClientSettings.PlayerAudio current = voice.settings().playerAudio(player.id());
        voice.settings().setPlayerVolume(player.id(), current.volume() + delta);
        voice.settingsChanged(false);
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        super.extractRenderState(graphics, mouseX, mouseY, delta);
        int left = width / 2 - 175;
        int top = Math.max(38, height / 2 - 118);
        graphics.text(font, title, width / 2 - font.width(title) / 2, top, 0xffffffff, true);
        if (players.isEmpty()) {
            graphics.text(font, "No visible players", width / 2 - font.width("No visible players") / 2,
                    top + 92, 0xff888888, false);
            return;
        }
        int start = page * PAGE_SIZE;
        int end = Math.min(players.size(), start + PAGE_SIZE);
        for (int index = start; index < end; index++) {
            ProximityVoiceClient.PlayerView player = players.get(index);
            int rowY = top + 30 + (index - start) * 28;
            ClientSettings.PlayerAudio playerAudio = voice.settings().playerAudio(player.id());
            VoiceRoster.Status status = voice.playerVoiceStatus(player.id());
            graphics.text(font, truncate(player.name(), 18), left, rowY + 2, statusColor(status), true);
            graphics.text(font, Math.round(playerAudio.volume() * 100) + "%", left + 128, rowY + 2, 0xffb0b0b0, false);
            graphics.text(font, status.name().toLowerCase(), left, rowY + 12, 0xff777777, false);
        }
        int pageCount = Math.max(1, (players.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        graphics.text(font, (page + 1) + " / " + pageCount, left + 75, top + 208, 0xff888888, false);
    }

    @Override
    public void onClose() {
        voice.settingsChanged(false);
        minecraft.gui.setScreen(parent);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    private static int statusColor(VoiceRoster.Status status) {
        return switch (status) {
            case SPEAKING -> 0xff55c779;
            case MUTED -> 0xffff7777;
            case IDLE -> 0xffd0d0d0;
            case DISCONNECTED -> 0xff777777;
        };
    }

    private static String truncate(String text, int maximum) {
        return text.length() <= maximum ? text : text.substring(0, maximum - 1) + "…";
    }
}
