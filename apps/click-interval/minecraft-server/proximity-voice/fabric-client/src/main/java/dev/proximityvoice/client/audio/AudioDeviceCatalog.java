package dev.proximityvoice.client.audio;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.LineUnavailableException;
import javax.sound.sampled.Mixer;
import javax.sound.sampled.SourceDataLine;
import javax.sound.sampled.TargetDataLine;
import java.util.ArrayList;
import java.util.List;

public final class AudioDeviceCatalog {
    public static final AudioFormat CAPTURE_FORMAT = new AudioFormat(48_000, 16, 1, true, false);
    public static final AudioFormat PLAYBACK_FORMAT = new AudioFormat(48_000, 16, 2, true, false);
    public static final String SYSTEM_DEFAULT = "";

    private AudioDeviceCatalog() {}

    public static List<String> inputDevices() {
        return devices(TargetDataLine.class, CAPTURE_FORMAT);
    }

    public static List<String> outputDevices() {
        return devices(SourceDataLine.class, PLAYBACK_FORMAT);
    }

    public static TargetDataLine openInput(String selected) throws LineUnavailableException {
        DataLine.Info lineInfo = new DataLine.Info(TargetDataLine.class, CAPTURE_FORMAT);
        TargetDataLine line;
        Mixer mixer = findMixer(selected, lineInfo);
        if (mixer == null) {
            line = (TargetDataLine) AudioSystem.getLine(lineInfo);
        } else {
            line = (TargetDataLine) mixer.getLine(lineInfo);
        }
        try {
            line.open(CAPTURE_FORMAT, 48_000 / 50 * 2 * 6);
            return line;
        } catch (LineUnavailableException | RuntimeException error) {
            try { line.close(); } catch (RuntimeException ignored) {}
            throw error;
        }
    }

    public static SourceDataLine openOutput(String selected) throws LineUnavailableException {
        DataLine.Info lineInfo = new DataLine.Info(SourceDataLine.class, PLAYBACK_FORMAT);
        SourceDataLine line;
        Mixer mixer = findMixer(selected, lineInfo);
        if (mixer == null) {
            line = (SourceDataLine) AudioSystem.getLine(lineInfo);
        } else {
            line = (SourceDataLine) mixer.getLine(lineInfo);
        }
        try {
            line.open(PLAYBACK_FORMAT, 48_000 / 50 * 4 * 8);
            return line;
        } catch (LineUnavailableException | RuntimeException error) {
            try { line.close(); } catch (RuntimeException ignored) {}
            throw error;
        }
    }

    private static List<String> devices(Class<?> lineClass, AudioFormat format) {
        DataLine.Info lineInfo = new DataLine.Info(lineClass, format);
        List<String> result = new ArrayList<>();
        for (Mixer.Info info : AudioSystem.getMixerInfo()) {
            try {
                if (AudioSystem.getMixer(info).isLineSupported(lineInfo)) result.add(info.getName());
            } catch (RuntimeException ignored) {
                // A disappearing USB device should not break the settings screen.
            }
        }
        return List.copyOf(result);
    }

    private static Mixer findMixer(String selected, DataLine.Info lineInfo) {
        if (selected == null || selected.isBlank()) return null;
        for (Mixer.Info info : AudioSystem.getMixerInfo()) {
            if (selected.equals(info.getName())) {
                Mixer mixer = AudioSystem.getMixer(info);
                return mixer.isLineSupported(lineInfo) ? mixer : null;
            }
        }
        return null;
    }
}
