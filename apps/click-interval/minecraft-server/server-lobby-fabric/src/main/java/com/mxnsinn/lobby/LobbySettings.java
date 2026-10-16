package com.mxnsinn.lobby;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.Set;

/** Validated immutable settings, loaded once per server lifecycle, never on a tick. */
public record LobbySettings(double x, double y, double z, float yaw, float pitch,
                            double minX, double maxX, double minY, double maxY, double minZ, double maxZ) {
    public static final LobbySettings LEGACY = new LobbySettings(0.5, 70, 25.5, 180, 0, -41, 41, 64, 110, -41, 41);
    public LobbySettings {
        for (double value : new double[]{x, y, z, yaw, pitch, minX, maxX, minY, maxY, minZ, maxZ}) {
            if (!Double.isFinite(value)) throw new IllegalArgumentException("Lobby settings must be finite");
        }
        if (minX >= maxX || minY >= maxY || minZ >= maxZ || maxX - minX > 4096 || maxZ - minZ > 4096
                || minY < -64 || maxY > 320 || minX < -29_999_900 || maxX > 29_999_900
                || minZ < -29_999_900 || maxZ > 29_999_900 || x <= minX || x >= maxX || y <= minY || y >= maxY
                || z <= minZ || z >= maxZ || pitch < -90 || pitch > 90 || yaw < -360 || yaw > 360) {
            throw new IllegalArgumentException("Lobby spawn or boundaries are invalid");
        }
    }
    public boolean outside(double currentX, double currentY, double currentZ) {
        return !Double.isFinite(currentX) || !Double.isFinite(currentY) || !Double.isFinite(currentZ)
                || currentX < minX || currentX > maxX || currentY < minY || currentY > maxY || currentZ < minZ || currentZ > maxZ;
    }
    public static LobbySettings parse(String text, String worldName) {
        JsonObject root = JsonParser.parseString(text).getAsJsonObject();
        exactKeys(root, Set.of("version", "world", "spawn", "bounds"));
        if (number(root, "version") != 1 || !root.get("world").isJsonPrimitive()
                || !root.get("world").getAsJsonPrimitive().isString() || !worldName.equals(root.get("world").getAsString())) {
            throw new IllegalArgumentException("Lobby settings do not match the candidate world");
        }
        JsonObject spawn = root.getAsJsonObject("spawn"), bounds = root.getAsJsonObject("bounds");
        exactKeys(spawn, Set.of("x", "y", "z", "yaw", "pitch"));
        exactKeys(bounds, Set.of("minX", "maxX", "minY", "maxY", "minZ", "maxZ"));
        return new LobbySettings(number(spawn, "x"), number(spawn, "y"), number(spawn, "z"),
                (float) number(spawn, "yaw"), (float) number(spawn, "pitch"),
                number(bounds, "minX"), number(bounds, "maxX"), number(bounds, "minY"), number(bounds, "maxY"),
                number(bounds, "minZ"), number(bounds, "maxZ"));
    }
    private static void exactKeys(JsonObject object, Set<String> keys) {
        if (object == null || !object.keySet().equals(keys)) throw new IllegalArgumentException("Unexpected lobby setting fields");
    }
    private static double number(JsonObject object, String key) {
        JsonElement element = object.get(key);
        if (element == null || !element.isJsonPrimitive() || !element.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("Lobby coordinate must be a number: " + key);
        }
        double value = element.getAsDouble();
        if (!Double.isFinite(value)) throw new IllegalArgumentException("Lobby number must be finite");
        return value;
    }
}
