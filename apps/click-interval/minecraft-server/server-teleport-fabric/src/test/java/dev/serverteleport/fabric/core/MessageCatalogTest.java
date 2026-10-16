package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class MessageCatalogTest {
    @Test
    void defaultsAreEnglishNeutralAndContainEveryRuntimeKey() {
        for (String template : MessageCatalog.defaultTemplates().values()) {
            assertFalse(template.toLowerCase().contains("click interval"));
            assertFalse(template.toLowerCase().contains("assembly"));
        }
        assertTrue(MessageCatalog.defaultTemplates().containsKey("server-limit"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("cross-dimension-disabled"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("destination-unavailable"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("destination-ambiguous"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("usage-tpa-player"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("location-saved"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("location-saved-go"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("location-invalid-name-v2"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("location-deleted"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("back-teleported"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("travel-player-passenger"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("travel-group-too-large"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("request-processing"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("destination-chunk-unavailable"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("warmup-countdown"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("warmup-cancelled-moved"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("warmup-cancelled-damage"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("cancelled-for-local-travel-requester"));
        assertTrue(MessageCatalog.defaultTemplates().containsKey("cancelled-for-local-travel-target"));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("usage-tpa-bring"));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("usage-tpa-entity"));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("entity-player-protected"));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("entity-unavailable"));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("entity-not-targeted"));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("entity-riding"));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("entity-location-unsafe"));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("entity-teleported"));
        assertEquals(
                "You got a TPA request from Alex. Would you like to",
                MessageCatalog.defaults().render(
                        "request-received-prompt", Map.of("requester", "Alex")));
        assertFalse(MessageCatalog.defaultTemplates().containsKey("request-received"));
    }

    @Test
    void renderingIsBoundedSingleLineAndSafe() {
        MessageCatalog catalog = new MessageCatalog(Map.of(
                "request-sent", "&a{requester}: {target} {unknown}",
                "no-pending", "",
                "not-real", "ignored"));

        String rendered = catalog.render("request-sent", Map.of(
                "requester", "A&clex",
                "target", "S§4am\n"));
        assertTrue(rendered.startsWith("§a"));
        assertTrue(rendered.contains("Alex: Sam"));
        assertFalse(rendered.contains("{unknown}"));
        assertFalse(rendered.contains("\n"));
        assertEquals("", catalog.render("no-pending", Map.of()));
        assertEquals("", catalog.render("not-real", Map.of()));

        String bounded = new MessageCatalog(Map.of("teleport-failed", "x".repeat(2_000)))
                .render("teleport-failed", Map.of());
        assertTrue(bounded.length() <= MessageCatalog.MAX_MESSAGE_LENGTH);
    }

    @Test
    void rendersACompleteTenPlacePageWithoutTruncatingThirtyPlaceLists() {
        String locations = java.util.stream.IntStream.range(0, 10)
                .mapToObj(index -> ("place_" + index + "_" + "x".repeat(24)).substring(0, 24))
                .collect(java.util.stream.Collectors.joining(", "));

        String rendered = MessageCatalog.defaults().render(
                "location-list", Map.of("locations", locations));

        assertEquals("Saved places: " + locations, rendered);
        assertTrue(rendered.length() <= MessageCatalog.MAX_MESSAGE_LENGTH);
    }
}
