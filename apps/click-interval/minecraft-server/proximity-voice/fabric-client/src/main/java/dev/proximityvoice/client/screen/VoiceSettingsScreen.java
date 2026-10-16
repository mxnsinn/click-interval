package dev.proximityvoice.client.screen;

import dev.proximityvoice.client.ProximityVoiceClient;
import dev.proximityvoice.client.audio.AudioDeviceCatalog;
import dev.proximityvoice.client.config.ClientSettings;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractSliderButton;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class VoiceSettingsScreen extends Screen {
    private final Screen parent;
    private final ProximityVoiceClient voice;
    private List<String> inputDevices = List.of("");
    private List<String> outputDevices = List.of("");

    public VoiceSettingsScreen(Screen parent, ProximityVoiceClient voice) {
        super(Component.literal("Proximity Voice"));
        this.parent = parent;
        this.voice = voice;
    }

    @Override
    protected void init() {
        inputDevices = withDefault(AudioDeviceCatalog.inputDevices());
        outputDevices = withDefault(AudioDeviceCatalog.outputDevices());
        int left = width / 2 - 155;
        int top = Math.max(36, height / 2 - 125);

        addRenderableWidget(Button.builder(inputLabel(), button -> {
            voice.settings().setInputDevice(next(inputDevices, voice.settings().inputDevice()));
            button.setMessage(inputLabel());
            voice.settingsChanged(true);
        }).bounds(left, top + 34, 310, 20).build());

        addRenderableWidget(Button.builder(outputLabel(), button -> {
            voice.settings().setOutputDevice(next(outputDevices, voice.settings().outputDevice()));
            button.setMessage(outputLabel());
            voice.settingsChanged(true);
        }).bounds(left, top + 60, 310, 20).build());

        addRenderableWidget(Button.builder(modeLabel(), button -> {
            ClientSettings.MicrophoneMode next = voice.settings().microphoneMode()
                    == ClientSettings.MicrophoneMode.HOLD_TO_SPEAK
                    ? ClientSettings.MicrophoneMode.TOGGLE
                    : ClientSettings.MicrophoneMode.HOLD_TO_SPEAK;
            voice.settings().setMicrophoneMode(next);
            voice.settings().setToggleMuted(next == ClientSettings.MicrophoneMode.TOGGLE);
            voice.settingsChanged(false);
            rebuildWidgets();
        }).bounds(left, top + 86, 203, 20).build());

        addRenderableWidget(Button.builder(muteLabel(), button -> {
            voice.settings().setToggleMuted(!voice.settings().toggleMuted());
            voice.settingsChanged(false);
            rebuildWidgets();
        }).bounds(left + 209, top + 86, 101, 20).build());

        addRenderableWidget(new MasterVolumeSlider(left, top + 112, 310, voice));

        addRenderableWidget(Button.builder(Component.literal("Player volumes"), button ->
                minecraft.gui.setScreen(new PlayerVolumeScreen(this, voice)))
                .bounds(left, top + 170, 152, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Done"), button -> onClose())
                .bounds(left + 158, top + 170, 152, 20).build());
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        super.extractRenderState(graphics, mouseX, mouseY, delta);
        int left = width / 2 - 155;
        int top = Math.max(36, height / 2 - 125);
        graphics.text(font, title, width / 2 - font.width(title) / 2, top, 0xffffffff, true);

        String status = voice.connectionState().name().toLowerCase(Locale.ROOT).replace('_', ' ');
        graphics.text(font, "Status: " + status, left, top + 15, statusColor(), true);
        String detail = voice.connectionDetail();
        if (!detail.isBlank()) {
            graphics.text(font, truncate(detail, 48), left + 95, top + 15, 0xffa0a0a0, false);
        }

        graphics.text(font, "Microphone test", left, top + 140, 0xffd0d0d0, false);
        int meterLeft = left + 96;
        int meterRight = left + 310;
        graphics.fill(meterLeft, top + 140, meterRight, top + 148, 0xff252525);
        int filled = (int) Math.round((meterRight - meterLeft) * Math.min(1.0, voice.audio().inputLevel() * 2.2));
        graphics.fill(meterLeft, top + 140, meterLeft + filled, top + 148,
                voice.isLocallyMuted() ? 0xffa05a5a : 0xff55c779);
        graphics.text(font, "Server distance: " + Math.round(voice.voiceRadius()) + " blocks", left, top + 155, 0xff909090, false);
        graphics.text(font, "V settings · G push to talk · M mute · remap in Controls", left, top + 197, 0xff777777, false);
        String audioError = voice.audio().lastError();
        if (!audioError.isBlank()) {
            graphics.text(font, truncate(audioError, 52), left, top + 211, 0xffff7777, false);
        }
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

    private Component inputLabel() {
        return Component.literal("Input: " + deviceName(voice.settings().inputDevice()));
    }

    private Component outputLabel() {
        return Component.literal("Output: " + deviceName(voice.settings().outputDevice()));
    }

    private Component modeLabel() {
        String mode = voice.settings().microphoneMode() == ClientSettings.MicrophoneMode.HOLD_TO_SPEAK
                ? "Hold to speak"
                : "Toggle";
        return Component.literal("Mode: " + mode);
    }

    private Component muteLabel() {
        if (voice.settings().microphoneMode() == ClientSettings.MicrophoneMode.HOLD_TO_SPEAK) {
            return Component.literal(voice.settings().toggleMuted() ? "Mic disabled" : "Mic ready");
        }
        return Component.literal(voice.settings().toggleMuted() ? "Muted" : "Unmuted");
    }

    private int statusColor() {
        return switch (voice.connectionState()) {
            case CONNECTED -> 0xff55c779;
            case ERROR -> 0xffff7777;
            case NEGOTIATING, ASSOCIATING -> 0xffffc857;
            case DISCONNECTED -> 0xff909090;
        };
    }

    private static List<String> withDefault(List<String> devices) {
        ArrayList<String> values = new ArrayList<>();
        values.add("");
        values.addAll(devices);
        return List.copyOf(values);
    }

    private static String next(List<String> values, String current) {
        int index = values.indexOf(current);
        return values.get((index < 0 ? 0 : index + 1) % values.size());
    }

    private static String deviceName(String value) {
        if (value == null || value.isBlank()) return "System default";
        return truncate(value, 39);
    }

    private static String truncate(String text, int maximum) {
        if (text == null || text.length() <= maximum) return String.valueOf(text == null ? "" : text);
        return text.substring(0, Math.max(0, maximum - 1)) + "…";
    }

    private static final class MasterVolumeSlider extends AbstractSliderButton {
        private final ProximityVoiceClient voice;

        private MasterVolumeSlider(int x, int y, int width, ProximityVoiceClient voice) {
            super(x, y, width, 20, Component.empty(), voice.settings().masterVolume() / 2.0);
            this.voice = voice;
            updateMessage();
        }

        @Override
        protected void updateMessage() {
            setMessage(Component.literal("Master volume: " + Math.round(value * 200) + "%"));
        }

        @Override
        protected void applyValue() {
            voice.settings().setMasterVolume(value * 2.0);
        }
    }
}
