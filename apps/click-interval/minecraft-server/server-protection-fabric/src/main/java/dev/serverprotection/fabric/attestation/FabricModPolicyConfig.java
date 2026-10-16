package dev.serverprotection.fabric.attestation;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/** Strict reader for the manager-rendered {@code modPolicy} section in Fabric config.yml. */
public final class FabricModPolicyConfig {
    private static final long MAX_BYTES = 256L * 1024L;
    private static final int MAX_LINES = 4_096;

    private FabricModPolicyConfig() {
    }

    public static ClientModPolicy load(Path file) throws IOException {
        if (file == null || !Files.isRegularFile(file) || Files.size(file) > MAX_BYTES) {
            throw new IOException("Protection config is missing or too large");
        }
        return parse(Files.readString(file, StandardCharsets.UTF_8));
    }

    public static ClientModPolicy parse(String yaml) throws IOException {
        if (yaml == null) return ClientModPolicy.disabled();
        if (yaml.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new IOException("Protection config is too large");
        }
        String[] lines = yaml.split("\\R", -1);
        if (lines.length > MAX_LINES) throw new IOException("Protection config has too many lines");
        boolean inSection = false;
        boolean found = false;
        boolean enabled = false;
        boolean require = false;
        boolean allowlist = false;
        int grace = 8;
        ClientModPolicy.Enforcement enforcement = ClientModPolicy.Enforcement.REPORT;
        Set<String> allowed = Set.of();
        Set<String> blocked = Set.of();
        Set<String> seen = new LinkedHashSet<>();

        for (String raw : lines) {
            String withoutComment = stripComment(raw);
            if (withoutComment.isBlank()) continue;
            int indentation = indentation(withoutComment);
            String line = withoutComment.strip();
            if (!inSection) {
                if (indentation == 0 && line.equals("modPolicy:")) {
                    if (found) throw new IOException("Duplicate modPolicy section");
                    found = true;
                    inSection = true;
                }
                continue;
            }
            if (indentation == 0) break;
            if (indentation != 2) throw new IOException("Invalid modPolicy indentation");
            int separator = line.indexOf(':');
            if (separator <= 0) throw new IOException("Invalid modPolicy entry");
            String key = line.substring(0, separator).trim();
            String value = line.substring(separator + 1).trim();
            if (!seen.add(key)) throw new IOException("Duplicate modPolicy key: " + key);
            switch (key) {
                case "enabled" -> enabled = bool(value, key);
                case "requireDeclaration" -> require = bool(value, key);
                case "enforceAllowlist" -> allowlist = bool(value, key);
                case "declarationGraceSeconds" -> grace = integer(value, key, 3, 60);
                case "enforcement" -> {
                    String normalized = value.toLowerCase(Locale.ROOT);
                    if (normalized.equals("report")) enforcement = ClientModPolicy.Enforcement.REPORT;
                    else if (normalized.equals("kick")) enforcement = ClientModPolicy.Enforcement.KICK;
                    else throw new IOException("modPolicy.enforcement must be report or kick");
                }
                case "allowed" -> allowed = modList(value, key);
                case "blocked" -> blocked = modList(value, key);
                default -> throw new IOException("Unknown modPolicy key: " + key);
            }
        }
        if (!found) return ClientModPolicy.disabled();
        LinkedHashSet<String> overlap = new LinkedHashSet<>(allowed);
        overlap.retainAll(blocked);
        if (!overlap.isEmpty()) throw new IOException("A mod cannot be both allowed and blocked");
        return new ClientModPolicy(enabled, require, allowlist, grace, enforcement, allowed, blocked);
    }

    private static Set<String> modList(String value, String key) throws IOException {
        if (!value.startsWith("[") || !value.endsWith("]")) {
            throw new IOException("modPolicy." + key + " must be an inline list");
        }
        String body = value.substring(1, value.length() - 1).trim();
        if (body.isEmpty()) return Set.of();
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (String token : body.split(",", -1)) {
            String item = token.trim();
            if (item.length() >= 2 && item.startsWith("\"") && item.endsWith("\"")) {
                item = item.substring(1, item.length() - 1);
            }
            String normalized = AttestationProtocol.normalizeModId(item);
            if (normalized == null) throw new IOException("Invalid mod ID in modPolicy." + key);
            result.add(normalized);
            if (result.size() > AttestationProtocol.MAX_MODS) {
                throw new IOException("Too many entries in modPolicy." + key);
            }
        }
        return Set.copyOf(result);
    }

    private static boolean bool(String value, String key) throws IOException {
        if (value.equalsIgnoreCase("true")) return true;
        if (value.equalsIgnoreCase("false")) return false;
        throw new IOException("modPolicy." + key + " must be true or false");
    }

    private static int integer(String value, String key, int minimum, int maximum) throws IOException {
        try {
            int parsed = Integer.parseInt(value);
            if (parsed < minimum || parsed > maximum) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException invalid) {
            throw new IOException("modPolicy." + key + " is outside its supported range");
        }
    }

    private static int indentation(String value) {
        int result = 0;
        while (result < value.length() && value.charAt(result) == ' ') result++;
        return result;
    }

    private static String stripComment(String value) {
        boolean quoted = false;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character == '"' && (index == 0 || value.charAt(index - 1) != '\\')) quoted = !quoted;
            if (character == '#' && !quoted) return value.substring(0, index);
        }
        return value;
    }
}
