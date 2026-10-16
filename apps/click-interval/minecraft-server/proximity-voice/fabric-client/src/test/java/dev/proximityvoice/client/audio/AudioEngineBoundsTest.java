package dev.proximityvoice.client.audio;

import dev.proximityvoice.client.config.ClientSettings;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AudioEngineBoundsTest {
    @TempDir
    Path temporary;

    @Test
    void remoteDecoderStateIsBoundedAndCleanedWithoutStartingDevices() {
        AudioEngine engine = new AudioEngine(
                new ClientSettings(temporary.resolve("voice.properties")),
                ignored -> {},
                () -> false,
                ignored -> SpatialSnapshot.unavailable());
        for (int index = 0; index < 64; index++) {
            engine.acceptVoice(new UUID(0L, index + 1L), new byte[]{1, 2, 3});
        }
        assertEquals(16, engine.remoteStreamCount(), "decoder count has a hard upper bound");
        engine.close();
        assertEquals(0, engine.remoteStreamCount(), "close clears queued audio even before start");
    }
}
