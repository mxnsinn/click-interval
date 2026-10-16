package dev.proximityvoice.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

public final class StatusFileWriter {
    private StatusFileWriter() {}

    public static void write(Path file, RelayStatus status) throws IOException {
        if (file == null || status == null) throw new IllegalArgumentException("file and status are required");
        Path parent = file.toAbsolutePath().normalize().getParent();
        if (parent == null) throw new IOException("Status file has no parent directory.");
        Files.createDirectories(parent);
        Path temporary = parent.resolve(file.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            Files.writeString(temporary, toJson(status), StandardCharsets.UTF_8);
            try {
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    public static String toJson(RelayStatus status) {
        RelayMetrics.Snapshot metrics = status.metrics();
        return "{\n"
                + "  \"schemaVersion\": 2,\n"
                + "  \"state\": \"" + escape(status.state()) + "\",\n"
                + "  \"protocolVersion\": " + status.protocolVersion() + ",\n"
                + "  \"transport\": \"udp\",\n"
                + "  \"udpReachability\": \"not-verified\",\n"
                + "  \"networkRequirement\": \"UDP port " + status.port()
                + " must be reachable separately from Minecraft TCP.\",\n"
                + "  \"bindAddress\": \"" + escape(status.bindAddress()) + "\",\n"
                + "  \"publicHost\": \"" + escape(status.publicHost()) + "\",\n"
                + "  \"port\": " + status.port() + ",\n"
                + "  \"voiceRadius\": " + status.voiceRadius() + ",\n"
                + "  \"sessions\": " + status.sessions() + ",\n"
                + "  \"associatedClients\": " + status.associatedClients() + ",\n"
                + "  \"metrics\": {\n"
                + "    \"received\": " + metrics.received() + ",\n"
                + "    \"authenticated\": " + metrics.authenticated() + ",\n"
                + "    \"rejected\": " + metrics.rejected() + ",\n"
                + "    \"replayed\": " + metrics.replayed() + ",\n"
                + "    \"rateLimited\": " + metrics.rateLimited() + ",\n"
                + "    \"associations\": " + metrics.associations() + ",\n"
                + "    \"voiceFrames\": " + metrics.voiceFrames() + ",\n"
                + "    \"routedRecipients\": " + metrics.routedRecipients() + "\n"
                + "  },\n"
                + "  \"lastError\": \"" + escape(status.lastError()) + "\",\n"
                + "  \"updatedAt\": \"" + escape(status.updatedAt()) + "\"\n"
                + "}\n";
    }

    private static String escape(String value) {
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '\\' -> result.append("\\\\");
                case '"' -> result.append("\\\"");
                case '\b' -> result.append("\\b");
                case '\f' -> result.append("\\f");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (character < 0x20) result.append(String.format("\\u%04x", (int) character));
                    else result.append(character);
                }
            }
        }
        return result.toString();
    }
}
