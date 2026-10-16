package dev.serverprotection.fabric.attestation;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Bounded wire protocol for the optional Fabric companion's advisory mod report.
 *
 * <p>The random per-connection nonce rejects stale/cross-session replays. It is deliberately not
 * described as authentication: code running on a player's computer can forge its own report.</p>
 */
public final class AttestationProtocol {
    public static final String CHANNEL_NAMESPACE = "serverprotection";
    public static final String CHANNEL_PATH = "attestation";
    public static final int PROTOCOL_VERSION = 1;
    public static final int NONCE_BYTES = 16;
    public static final int MAX_PAYLOAD_BYTES = 24 * 1024;
    public static final int MAX_MODS = 256;
    public static final int MAX_MOD_ID_BYTES = 64;
    public static final int MAX_MOD_VERSION_BYTES = 96;
    public static final int MAX_REPORTER_VERSION_BYTES = 32;

    private static final int MAGIC = 0x53504131; // SPA1
    private static final int TYPE_CHALLENGE = 1;
    private static final int TYPE_REPORT = 2;
    private static final int FLAG_TRUNCATED = 1;
    private static final int HEADER_BYTES = Integer.BYTES + 2;

    private AttestationProtocol() {
    }

    public static byte[] encodeChallenge(byte[] nonce) {
        byte[] safeNonce = requireNonce(nonce);
        ByteBuffer output = ByteBuffer.allocate(HEADER_BYTES + NONCE_BYTES).order(ByteOrder.BIG_ENDIAN);
        writeHeader(output, TYPE_CHALLENGE);
        output.put(safeNonce);
        return output.array();
    }

    public static Challenge decodeChallenge(byte[] payload) {
        ByteBuffer input = input(payload);
        requireHeader(input, TYPE_CHALLENGE);
        if (input.remaining() != NONCE_BYTES) throw invalid("Invalid challenge length");
        byte[] nonce = new byte[NONCE_BYTES];
        input.get(nonce);
        return new Challenge(nonce);
    }

    public static byte[] encodeReport(
            byte[] nonce,
            String reporterVersion,
            Collection<ModEntry> installedMods
    ) {
        byte[] safeNonce = requireNonce(nonce);
        byte[] safeReporter = ascii(reporterVersion, MAX_REPORTER_VERSION_BYTES, "reporter version");
        LinkedHashMap<String, ModEntry> normalized = new LinkedHashMap<>();
        if (installedMods != null) {
            installedMods.stream()
                    .filter(entry -> entry != null)
                    .map(entry -> new ModEntry(normalizeModId(entry.id()), normalizeVersion(entry.version())))
                    .filter(entry -> entry.id() != null)
                    .sorted(Comparator.comparing(ModEntry::id))
                    .forEach(entry -> normalized.putIfAbsent(entry.id(), entry));
        }
        boolean truncated = normalized.size() > MAX_MODS;
        List<ModEntry> entries = new ArrayList<>(Math.min(normalized.size(), MAX_MODS));
        for (ModEntry entry : normalized.values()) {
            if (entries.size() == MAX_MODS) break;
            entries.add(entry);
        }

        ByteArrayOutputStream output = new ByteArrayOutputStream(256);
        writeInt(output, MAGIC);
        output.write(PROTOCOL_VERSION);
        output.write(TYPE_REPORT);
        output.writeBytes(safeNonce);
        output.write(truncated ? FLAG_TRUNCATED : 0);
        writeSized(output, safeReporter);
        writeUnsignedShort(output, entries.size());
        for (ModEntry entry : entries) {
            writeSized(output, ascii(entry.id(), MAX_MOD_ID_BYTES, "mod ID"));
            writeSized(output, utf8(entry.version(), MAX_MOD_VERSION_BYTES, "mod version"));
        }
        byte[] result = output.toByteArray();
        if (result.length > MAX_PAYLOAD_BYTES) throw invalid("Mod report is too large");
        return result;
    }

    public static Report decodeReport(byte[] payload, byte[] expectedNonce) {
        ByteBuffer input = input(payload);
        requireHeader(input, TYPE_REPORT);
        byte[] nonce = new byte[NONCE_BYTES];
        if (input.remaining() < NONCE_BYTES) throw invalid("Missing report nonce");
        input.get(nonce);
        if (!constantTimeEquals(nonce, requireNonce(expectedNonce))) {
            throw invalid("Report nonce does not match this connection");
        }
        if (input.remaining() < 4) throw invalid("Incomplete report");
        int flags = Byte.toUnsignedInt(input.get());
        if ((flags & ~FLAG_TRUNCATED) != 0) throw invalid("Unsupported report flags");
        String reporter = readSized(input, MAX_REPORTER_VERSION_BYTES, true, "reporter version");
        int count = Short.toUnsignedInt(input.getShort());
        if (count > MAX_MODS) throw invalid("Too many reported mods");
        LinkedHashMap<String, String> mods = new LinkedHashMap<>();
        for (int index = 0; index < count; index++) {
            String rawId = readSized(input, MAX_MOD_ID_BYTES, true, "mod ID");
            String id = normalizeModId(rawId);
            if (id == null || !id.equals(rawId)) throw invalid("Invalid normalized mod ID");
            String version = readSized(input, MAX_MOD_VERSION_BYTES, false, "mod version");
            if (mods.putIfAbsent(id, version) != null) throw invalid("Duplicate mod ID");
        }
        if (input.hasRemaining()) throw invalid("Trailing report data");
        return new Report(reporter, Map.copyOf(mods), (flags & FLAG_TRUNCATED) != 0);
    }

    public static String normalizeModId(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (normalized.isEmpty() || normalized.length() > MAX_MOD_ID_BYTES) return null;
        for (int index = 0; index < normalized.length(); index++) {
            char character = normalized.charAt(index);
            if (!(character >= 'a' && character <= 'z')
                    && !(character >= '0' && character <= '9')
                    && character != '_' && character != '-' && character != '.') return null;
        }
        return normalized;
    }

    /** Infrastructure entries reported by Fabric Loader are not user-selectable gameplay mods. */
    public static boolean isInfrastructureMod(String value) {
        String id = normalizeModId(value);
        if (id == null) return false;
        return id.equals("minecraft")
                || id.equals("java")
                || id.equals("fabricloader")
                || id.equals("fabric-api")
                || id.equals("serverprotection_companion")
                || id.equals("mixinextras")
                || id.startsWith("fabric-")
                || id.startsWith("org_ow2_asm_");
    }

    private static String normalizeVersion(String value) {
        if (value == null || value.isBlank()) return "unknown";
        String clean = value.strip();
        StringBuilder result = new StringBuilder(Math.min(clean.length(), MAX_MOD_VERSION_BYTES));
        for (int index = 0; index < clean.length() && result.length() < MAX_MOD_VERSION_BYTES; index++) {
            char character = clean.charAt(index);
            // Mod metadata versions are identifiers, not display prose. Keeping this printable
            // ASCII makes the byte bound exact and prevents odd metadata from suppressing a report.
            if (character >= 0x20 && character <= 0x7e) result.append(character);
            else if (!Character.isISOControl(character)) result.append('?');
        }
        return result.isEmpty() ? "unknown" : result.toString();
    }

    private static ByteBuffer input(byte[] payload) {
        if (payload == null || payload.length < HEADER_BYTES || payload.length > MAX_PAYLOAD_BYTES) {
            throw invalid("Invalid attestation payload length");
        }
        return ByteBuffer.wrap(Arrays.copyOf(payload, payload.length)).order(ByteOrder.BIG_ENDIAN);
    }

    private static void writeHeader(ByteBuffer output, int type) {
        output.putInt(MAGIC).put((byte) PROTOCOL_VERSION).put((byte) type);
    }

    private static void requireHeader(ByteBuffer input, int expectedType) {
        if (input.remaining() < HEADER_BYTES
                || input.getInt() != MAGIC
                || Byte.toUnsignedInt(input.get()) != PROTOCOL_VERSION
                || Byte.toUnsignedInt(input.get()) != expectedType) {
            throw invalid("Unsupported attestation message");
        }
    }

    private static byte[] requireNonce(byte[] nonce) {
        if (nonce == null || nonce.length != NONCE_BYTES) throw invalid("Invalid nonce");
        return Arrays.copyOf(nonce, nonce.length);
    }

    private static boolean constantTimeEquals(byte[] left, byte[] right) {
        int mismatch = left.length ^ right.length;
        int length = Math.min(left.length, right.length);
        for (int index = 0; index < length; index++) mismatch |= left[index] ^ right[index];
        return mismatch == 0;
    }

    private static byte[] ascii(String value, int maximum, String label) {
        String clean = value == null ? "" : value.strip();
        if (clean.isEmpty() || clean.length() > maximum) throw invalid("Invalid " + label);
        for (int index = 0; index < clean.length(); index++) {
            char character = clean.charAt(index);
            if (character < 0x21 || character > 0x7e) throw invalid("Invalid " + label);
        }
        return clean.getBytes(StandardCharsets.US_ASCII);
    }

    private static byte[] utf8(String value, int maximum, String label) {
        byte[] bytes = (value == null ? "" : value).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > maximum) throw invalid("Invalid " + label);
        return bytes;
    }

    private static void writeSized(ByteArrayOutputStream output, byte[] bytes) {
        if (bytes.length > 255) throw invalid("Field is too large");
        output.write(bytes.length);
        output.writeBytes(bytes);
    }

    private static String readSized(ByteBuffer input, int maximum, boolean ascii, String label) {
        if (!input.hasRemaining()) throw invalid("Missing " + label);
        int length = Byte.toUnsignedInt(input.get());
        if (length == 0 || length > maximum || input.remaining() < length) throw invalid("Invalid " + label);
        byte[] bytes = new byte[length];
        input.get(bytes);
        if (ascii) {
            for (byte value : bytes) {
                int character = Byte.toUnsignedInt(value);
                if (character < 0x21 || character > 0x7e) throw invalid("Invalid " + label);
            }
            return new String(bytes, StandardCharsets.US_ASCII);
        }
        try {
            String value = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
            for (int index = 0; index < value.length(); index++) {
                if (Character.isISOControl(value.charAt(index))) throw invalid("Invalid " + label);
            }
            return value;
        } catch (CharacterCodingException error) {
            throw invalid("Invalid " + label);
        }
    }

    private static void writeInt(ByteArrayOutputStream output, int value) {
        output.write((value >>> 24) & 0xff);
        output.write((value >>> 16) & 0xff);
        output.write((value >>> 8) & 0xff);
        output.write(value & 0xff);
    }

    private static void writeUnsignedShort(ByteArrayOutputStream output, int value) {
        output.write((value >>> 8) & 0xff);
        output.write(value & 0xff);
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }

    public record Challenge(byte[] nonce) {
        public Challenge {
            nonce = requireNonce(nonce);
        }

        @Override
        public byte[] nonce() {
            return Arrays.copyOf(nonce, nonce.length);
        }
    }

    public record ModEntry(String id, String version) {
    }

    public record Report(String reporterVersion, Map<String, String> mods, boolean truncated) {
        public Report {
            reporterVersion = reporterVersion == null ? "" : reporterVersion;
            mods = mods == null ? Map.of() : Map.copyOf(mods);
        }
    }
}
