package dev.serverenchantments.fabric;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import java.util.*;

/** Persisted by vanilla's world saving. Saturation fails closed instead of forgetting buildings. */
final class PlacedLogs extends SavedData {
    static final int LIMIT = 200_000;
    static final Codec<PlacedLogs> CODEC = RecordCodecBuilder.create(instance -> instance.group(
            Codec.LONG.listOf().fieldOf("positions").forGetter(data -> List.copyOf(data.positions)),
            Codec.BOOL.optionalFieldOf("saturated", false).forGetter(data -> data.saturated)
    ).apply(instance, PlacedLogs::new));
    static final SavedDataType<PlacedLogs> TYPE = new SavedDataType<>(
            Identifier.fromNamespaceAndPath("serverenchantments", "placed_logs"), PlacedLogs::new, CODEC, null);
    private final Set<Long> positions = new HashSet<>();
    private boolean saturated;
    private PlacedLogs() { }
    private PlacedLogs(List<Long> positions, boolean saturated) {
        this.saturated = saturated || positions.size() > LIMIT;
        positions.stream().limit(LIMIT).forEach(this.positions::add);
    }
    boolean contains(long position) { return saturated || positions.contains(position); }
    void add(long position) {
        if (positions.contains(position) || saturated) return;
        if (positions.size() >= LIMIT) saturated = true;
        else positions.add(position);
        setDirty();
    }
    void remove(long position) { if (positions.remove(position)) setDirty(); }
}
