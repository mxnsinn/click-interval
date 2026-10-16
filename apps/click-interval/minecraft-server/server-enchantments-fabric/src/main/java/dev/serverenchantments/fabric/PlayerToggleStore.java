package dev.serverenchantments.fabric;

import java.io.IOException;
import java.io.StringReader;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.function.Consumer;

/** Server-thread-only, world-local preferences. Never reads or rewrites an ItemStack. */
final class PlayerToggleStore {
    enum Feature {
        MINER("miner", "Miner's Sweep"), TREE("tree", "Tree Chop"), HARVESTER("harvester", "Harvester Sweep");
        final String id, label;
        Feature(String id, String label) { this.id = id; this.label = label; }
    }
    record State(boolean miner, boolean tree, boolean harvester) {
        static final State DEFAULT = new State(true, true, true);
        static final State SAFE = new State(false, false, false);
        boolean enabled(Feature feature) { return switch (feature) { case MINER -> miner; case TREE -> tree; case HARVESTER -> harvester; }; }
        State with(Feature feature, boolean enabled) {
            return new State(feature == Feature.MINER ? enabled : miner,
                    feature == Feature.TREE ? enabled : tree, feature == Feature.HARVESTER ? enabled : harvester);
        }
    }
    record Snapshot(State state, long revision) { }
    private static final int MAX_BYTES = 4096;
    private final Path directory;
    private final Consumer<String> warning;
    private final Map<UUID, Snapshot> cache = new HashMap<>();
    private long nextRevision;

    PlayerToggleStore(Path directory, Consumer<String> warning) { this.directory = directory; this.warning = warning; }
    Snapshot get(UUID player) { return cache.computeIfAbsent(player, id -> new Snapshot(read(id), ++nextRevision)); }
    void forget(UUID player) { cache.remove(player); }
    boolean enabled(UUID player, Feature feature) { return get(player).state.enabled(feature); }
    void set(UUID player, Feature feature, boolean enabled) throws IOException {
        Snapshot old = get(player);
        State next = old.state.with(feature, enabled);
        if (next.equals(old.state)) return;
        write(player, next); // Do not report success or change live behavior unless the replacement committed.
        cache.put(player, new Snapshot(next, ++nextRevision));
    }
    private Path path(UUID player) { return directory.resolve("player-toggles." + player + ".properties"); }
    private State read(UUID player) {
        Path file = path(player);
        try {
            byte[] bytes;
            try (var input = Files.newInputStream(file)) { bytes = input.readNBytes(MAX_BYTES + 1); }
            if (bytes.length > MAX_BYTES) throw new IOException("Preference file exceeds 4096 bytes");
            Properties values = new Properties();
            values.load(new StringReader(new String(bytes, StandardCharsets.UTF_8)));
            if (!"1".equals(values.getProperty("version")) || values.size() != 4)
                throw new IOException("Invalid preference version or fields");
            return new State(bool(values, "miner"), bool(values, "tree"), bool(values, "harvester"));
        } catch (NoSuchFileException missing) {
            return State.DEFAULT;
        } catch (IOException | IllegalArgumentException invalid) {
            warning.accept("Cannot load enchantment preferences for " + player + "; extra harvesting disabled safely: " + invalid.getMessage());
            return State.SAFE;
        }
    }
    private static boolean bool(Properties values, String key) throws IOException {
        String value = values.getProperty(key);
        if ("true".equals(value)) return true;
        if ("false".equals(value)) return false;
        throw new IOException("Invalid boolean: " + key);
    }
    private void write(UUID player, State state) throws IOException {
        Files.createDirectories(directory);
        Path temporary = Files.createTempFile(directory, "toggle-", ".tmp");
        try {
            byte[] bytes = ("version=1\nminer=" + state.miner + "\ntree=" + state.tree
                    + "\nharvester=" + state.harvester + "\n").getBytes(StandardCharsets.UTF_8);
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            // Unsupported atomic replacement fails closed; never truncate the last known good file.
            Files.move(temporary, path(player), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
    }
}
