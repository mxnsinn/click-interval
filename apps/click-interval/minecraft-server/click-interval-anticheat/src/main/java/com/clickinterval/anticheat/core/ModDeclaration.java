package com.clickinterval.anticheat.core;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/** Parser for the optional companion-client declaration channel. */
public final class ModDeclaration {
    public static final String CHANNEL = "serverprotection:mods";
    public static final String LEGACY_CHANNEL = "clickinterval:mods";
    public static final String HEADER = "SERVER_PROTECTION_MODS_1";
    public static final String LEGACY_HEADER = "CI_MODS_1";
    public static final int MAX_BYTES = 24 * 1024;
    public static final int MAX_MODS = 256;

    private ModDeclaration() {
    }

    public static boolean isSupportedChannel(String channel) {
        return CHANNEL.equals(channel) || LEGACY_CHANNEL.equals(channel);
    }

    /**
     * Wire format: UTF-8 text containing {@code SERVER_PROTECTION_MODS_1} followed by one mod ID per line.
     * The previous header remains accepted so existing companion clients can migrate without an outage.
     * An optional {@code @version} suffix is accepted but ignored by policy matching.
     */
    public static Set<String> parse(byte[] payload) {
        if (payload == null || payload.length == 0 || payload.length > MAX_BYTES) {
            throw new IllegalArgumentException("Mod declaration payload has an invalid size");
        }
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(payload))
                    .toString();
        } catch (CharacterCodingException error) {
            throw new IllegalArgumentException("Mod declaration is not valid UTF-8", error);
        }
        String[] lines = text.replace("\r\n", "\n").split("\n", -1);
        if (lines.length == 0 || (!HEADER.equals(lines[0]) && !LEGACY_HEADER.equals(lines[0]))) {
            throw new IllegalArgumentException("Unsupported mod declaration protocol");
        }
        LinkedHashSet<String> mods = new LinkedHashSet<>();
        for (int index = 1; index < lines.length; index++) {
            String line = lines[index].trim();
            if (line.isEmpty()) continue;
            int versionAt = line.indexOf('@');
            String rawId = versionAt < 0 ? line : line.substring(0, versionAt);
            String modId = normalizeModId(rawId);
            if (modId == null) throw new IllegalArgumentException("Invalid declared mod ID");
            mods.add(modId);
            if (mods.size() > MAX_MODS) throw new IllegalArgumentException("Too many declared mods");
        }
        return Set.copyOf(mods);
    }

    static String normalizeModId(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (normalized.isEmpty() || normalized.length() > 64) return null;
        for (int index = 0; index < normalized.length(); index++) {
            char character = normalized.charAt(index);
            if (!(character >= 'a' && character <= 'z')
                    && !(character >= '0' && character <= '9')
                    && character != '_' && character != '-' && character != '.') return null;
        }
        return normalized;
    }
}
