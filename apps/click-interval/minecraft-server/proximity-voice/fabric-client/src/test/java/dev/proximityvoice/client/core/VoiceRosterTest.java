package dev.proximityvoice.client.core;

import dev.proximityvoice.client.protocol.ControlCodec;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class VoiceRosterTest {
    @Test
    void ignoresDuplicateAndStaleRevisions() {
        VoiceRoster roster = new VoiceRoster();
        UUID player = UUID.randomUUID();
        assertTrue(roster.apply(new ControlCodec.Roster(4,
                Map.of(player, new ControlCodec.RosterState(true, true)))));
        assertFalse(roster.apply(new ControlCodec.Roster(4, Map.of())));
        assertFalse(roster.apply(new ControlCodec.Roster(3, Map.of())));
        assertEquals(VoiceRoster.Status.MUTED, roster.status(player, 1_000));
    }

    @Test
    void speakingStateDecays() {
        VoiceRoster roster = new VoiceRoster();
        UUID player = UUID.randomUUID();
        roster.apply(new ControlCodec.Roster(1,
                Map.of(player, new ControlCodec.RosterState(true, false))));
        roster.markSpeaking(player, 1_000);
        assertEquals(VoiceRoster.Status.SPEAKING, roster.status(player, 1_300));
        assertEquals(VoiceRoster.Status.IDLE, roster.status(player, 1_351));
    }
}
