package dev.serverprotection.client;

import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Properties;

/** Read once at startup; writes happen only on an explicit client command, never while rendering. */
final class SelfNameTagSettings {
    static final int MAX_BYTES = 4096;
    private final Path file;
    private volatile boolean enabled = false;

    SelfNameTagSettings(Path file) { this.file = file; }
    boolean enabled() { return enabled; }

    void load() throws IOException {
        if (Files.notExists(file, LinkOption.NOFOLLOW_LINKS)) return;
        try {
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Not a regular settings file");
            byte[] bytes;
            try (var input = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
                bytes = input.readNBytes(MAX_BYTES + 1);
            }
            if (bytes.length > MAX_BYTES) throw new IOException("Settings file is too large");
            Properties values = new Properties();
            values.load(new StringReader(new String(bytes, StandardCharsets.UTF_8)));
            String value = values.getProperty("showOwnNametag", "").strip();
            if (!value.equals("true") && !value.equals("false")) throw new IOException("Invalid showOwnNametag value");
            enabled = Boolean.parseBoolean(value);
        } catch (IOException | IllegalArgumentException failure) {
            enabled = false; // Do not silently re-enable an unreadable user preference.
            throw new IOException("Could not read own-nametag settings; feature disabled", failure);
        }
    }

    void setEnabled(boolean requested) throws IOException {
        if (Files.exists(file, LinkOption.NOFOLLOW_LINKS)
                && !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Not a regular settings file");
        }
        Files.createDirectories(file.toAbsolutePath().getParent());
        Path temporary = Files.createTempFile(file.toAbsolutePath().getParent(), "companion-nametag-", ".tmp");
        try {
            Files.writeString(temporary, "# Server Protection Companion: Show my nametag (third person only)\n"
                    + "showOwnNametag=" + requested + "\n", StandardCharsets.UTF_8);
            try {
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            }
            enabled = requested;
        } finally {
            Files.deleteIfExists(temporary);
        }
    }
}
