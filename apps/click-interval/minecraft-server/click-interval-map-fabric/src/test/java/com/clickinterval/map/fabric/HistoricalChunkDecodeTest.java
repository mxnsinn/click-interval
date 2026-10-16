package com.clickinterval.map.fabric;

import com.mojang.serialization.Lifecycle;
import net.minecraft.SharedConstants;
import net.minecraft.core.MappedRegistry;
import net.minecraft.core.RegistrationInfo;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.Registries;
import net.minecraft.data.worldgen.biome.OverworldBiomes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.StringTag;
import net.minecraft.server.Bootstrap;
import net.minecraft.util.SimpleBitStorage;
import net.minecraft.world.level.LevelHeightAccessor;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.biome.BiomeGenerationSettings;
import net.minecraft.world.level.biome.Biomes;
import net.minecraft.world.level.biome.MobSpawnSettings;
import net.minecraft.world.level.chunk.PalettedContainerFactory;
import net.minecraft.world.level.chunk.storage.SerializableChunkData;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.RandomAccessFile;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.zip.InflaterInputStream;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.*;

/** Real Minecraft accessor, compressed NBT and palette decoding, without a server or world writes. */
class HistoricalChunkDecodeTest {
    private static PalettedContainerFactory containers;
    @TempDir Path temporary;

    @BeforeAll
    static void bootstrapNativeCodecs() throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        var biomes = new MappedRegistry<Biome>(Registries.BIOME, Lifecycle.stable());
        // Register every native biome identifier so real saved palettes are validated, not
        // silently replaced with a default. Map coloring uses their identifiers, not features.
        for (var field : Biomes.class.getFields()) {
            if (field.getType() != net.minecraft.resources.ResourceKey.class) continue;
            @SuppressWarnings("unchecked")
            var key = (net.minecraft.resources.ResourceKey<Biome>) field.get(null);
            biomes.register(key, OverworldBiomes.baseBiome(0.8f, 0.4f)
                    .generationSettings(BiomeGenerationSettings.EMPTY)
                    .mobSpawnSettings(MobSpawnSettings.EMPTY).build(), RegistrationInfo.BUILT_IN);
        }
        biomes.freeze();
        containers = PalettedContainerFactory.create(new RegistryAccess.ImmutableRegistryAccess(List.of(biomes)));
    }

    @Test
    void snapshotsActualOverworldAndNetherAccessorBounds() {
        var overworld = ClickIntervalMapFabric.historicalHeightAccessor(LevelHeightAccessor.create(-64, 384));
        assertEquals(-64, overworld.getMinY());
        assertEquals(384, overworld.getHeight());
        assertEquals(319, overworld.getMaxY());
        assertEquals(24, overworld.getSectionsCount());
        assertTrue(overworld.isInsideBuildHeight(-64));
        assertTrue(overworld.isInsideBuildHeight(319));
        assertFalse(overworld.isInsideBuildHeight(320));
        var nether = ClickIntervalMapFabric.historicalHeightAccessor(LevelHeightAccessor.create(0, 256));
        assertEquals(0, nether.getMinY());
        assertEquals(256, nether.getHeight());
        assertEquals(255, nether.getMaxY());
        assertEquals(16, nether.getSectionsCount());
    }

    @Test
    void swappedBoundsReproduceNativeSectionRejection() throws Exception {
        CompoundTag stored = roundTrip(chunk(4, "minecraft:grass_block", null));
        var broken = SerializableChunkData.parse(LevelHeightAccessor.create(384, -64), containers, stored);
        assertNotNull(broken);
        assertTrue(broken.sectionData().stream().allMatch(s -> s.chunkSection() == null));
        var fixed = SerializableChunkData.parse(
                ClickIntervalMapFabric.historicalHeightAccessor(LevelHeightAccessor.create(-64, 384)), containers, stored);
        assertNotNull(fixed);
        assertTrue(fixed.sectionData().stream().anyMatch(s -> s.chunkSection() != null));
    }

    @Test
    void decodesSavedOverworldHeightmapAndGrassPalette() throws Exception {
        var bounds = LevelHeightAccessor.create(-64, 384);
        var heights = new SimpleBitStorage(9, 256);
        for (int i = 0; i < 256; i++) heights.set(i, 80 - bounds.getMinY());
        var surface = decode("minecraft:overworld", bounds, chunk(4, "minecraft:grass_block", heights.getRaw()));
        assertNotNull(surface);
        assertEquals(79, surface.coarse().y());
        assertEquals("minecraft:grass_block", surface.coarse().block());
        assertEquals(TerrainColorPalette.colorFor("minecraft:grass_block", "minecraft:plains"), surface.coarse().color());
    }

    @Test
    void fallbackIncludesTopmostLegalOverworldBlock() throws Exception {
        var surface = decode("minecraft:overworld", LevelHeightAccessor.create(-64, 384),
                chunk(19, "minecraft:stone", null));
        assertNotNull(surface);
        assertEquals(319, surface.coarse().y(), "Fallback must include the inclusive upper boundary");
        assertEquals("minecraft:stone", surface.coarse().block());
    }

    @Test
    void decodesNetherAndEndWithoutLoadingWorldChunks() throws Exception {
        var nether = decode("minecraft:the_nether", LevelHeightAccessor.create(0, 256),
                chunk(7, "minecraft:netherrack", null));
        assertNotNull(nether);
        assertEquals(127, nether.coarse().y());
        assertEquals("minecraft:netherrack", nether.coarse().block());
        var end = decode("minecraft:the_end", LevelHeightAccessor.create(0, 256),
                chunk(3, "minecraft:end_stone", null));
        assertNotNull(end);
        assertEquals(63, end.coarse().y());
        assertEquals("minecraft:end_stone", end.coarse().block());
    }

    @Test
    void completeAirIsSuccessfulWithoutSurfaceSamplesOrVisiblePixels() throws Exception {
        var result = decode("minecraft:the_end", LevelHeightAccessor.create(0, 256), fullVoid());
        assertNotNull(result);
        assertTrue(ClickIntervalMapFabric.isKnownEmpty(result.coarse()));
        assertTrue(result.details().isEmpty());
        var stone = new ClickIntervalMapFabric.TerrainCell("minecraft:the_end", 16, 0, 60,
                "#808080", "minecraft:stone", 16);
        var ordinaryAir = new ClickIntervalMapFabric.TerrainCell("minecraft:the_end", 32, 0, 0,
                "#123456", "minecraft:air", 16);
        StringBuilder json = new StringBuilder();
        ClickIntervalMapFabric.appendTerrainJson(json, List.of(result.coarse(), stone, result.coarse(), ordinaryAir));
        var parsed = com.google.gson.JsonParser.parseString("[" + json + "]").getAsJsonArray();
        assertEquals(2, parsed.size());
        assertEquals("minecraft:stone", parsed.get(0).getAsJsonArray().get(5).getAsString());
        assertEquals("#123456", parsed.get(1).getAsJsonArray().get(4).getAsString());
    }

    @Test
    void protoMissingAndMalformedSectionsNeverBecomeKnownVoid() throws Exception {
        var bounds = LevelHeightAccessor.create(0, 256);
        var proto = fullVoid();
        proto.putString("Status", "minecraft:empty");
        assertNull(decode("minecraft:the_end", bounds, proto));
        var missingSection = fullVoid();
        missingSection.getListOrEmpty("sections").remove(0);
        assertNull(decode("minecraft:the_end", bounds, missingSection));
        var missingStates = fullVoid();
        missingStates.getListOrEmpty("sections").getCompoundOrEmpty(0).remove("block_states");
        assertNull(decode("minecraft:the_end", bounds, missingStates));
        var missingBiomes = fullVoid();
        missingBiomes.getListOrEmpty("sections").getCompoundOrEmpty(0).remove("biomes");
        assertNull(decode("minecraft:the_end", bounds, missingBiomes));
        var malformedBiomes = fullVoid();
        malformedBiomes.getListOrEmpty("sections").getCompoundOrEmpty(0)
                .getCompoundOrEmpty("biomes").put("palette", new ListTag());
        assertNull(decode("minecraft:the_end", bounds, malformedBiomes));
        var corruptStates = fullVoid();
        corruptStates.getListOrEmpty("sections").getCompoundOrEmpty(0)
                .getCompoundOrEmpty("block_states").putLongArray("data", new long[]{42});
        assertNull(decode("minecraft:the_end", bounds, corruptStates));
        var duplicateSection = fullVoid();
        duplicateSection.getListOrEmpty("sections").add(
                duplicateSection.getListOrEmpty("sections").getCompoundOrEmpty(0).copy());
        assertNull(decode("minecraft:the_end", bounds, duplicateSection));
        var missingAll = fullVoid();
        missingAll.remove("sections");
        assertNull(decode("minecraft:the_end", bounds, missingAll));
        var missingPosition = fullVoid();
        missingPosition.remove("xPos");
        assertNull(decode("minecraft:the_end", bounds, missingPosition));
        var context = new ClickIntervalMapFabric.HistoricalDimension(null, bounds, containers, null,
                "minecraft:the_end", 0, 0, -100, 100, -100, 100, 0);
        assertNull(ClickIntervalMapFabric.historicalSurface(
                new ClickIntervalMapFabric.HistoricalChunk(context, 1, 0, 0), fullVoid()));
    }

    @Test
    void emptyCoverageSurvivesCacheRoundTripAndLiveResamplingReplacesIt() throws Exception {
        var empty = decode("minecraft:the_end", LevelHeightAccessor.create(0, 256), fullVoid()).coarse();
        var write = ClickIntervalMapFabric.class.getDeclaredMethod("writeTerrainCache", Path.class, List.class, String.class);
        write.setAccessible(true);
        write.invoke(null, temporary, List.of(empty), "# click-interval-map-cache-v3");
        var mod = new ClickIntervalMapFabric();
        var directory = ClickIntervalMapFabric.class.getDeclaredField("outputDirectory");
        directory.setAccessible(true);
        directory.set(mod, temporary);
        var load = ClickIntervalMapFabric.class.getDeclaredMethod("loadTerrainCache");
        load.setAccessible(true);
        load.invoke(mod);
        var coarse = cells(mod, "coarseTerrain");
        assertEquals(empty, coarse.get("minecraft:the_end:0:0:coarse"));
        assertTrue(cells(mod, "terrain").isEmpty());
        StringBuilder json = new StringBuilder();
        ClickIntervalMapFabric.appendTerrainJson(json, List.copyOf(coarse.values()));
        assertTrue(json.isEmpty(), "Persisted empty coverage must never fabricate a terrain tile");

        var newSurface = new ClickIntervalMapFabric.TerrainCell("minecraft:the_end", 8, 8, 75,
                "#808080", "minecraft:stone", 4);
        cells(mod, "terrain").put("minecraft:the_end:8:8", newSurface);
        var resample = ClickIntervalMapFabric.class.getDeclaredMethod("updateCoarseFromLoadedSamples", String.class, int.class, int.class);
        resample.setAccessible(true);
        resample.invoke(mod, "minecraft:the_end", 0, 0);
        assertEquals("minecraft:stone", coarse.get("minecraft:the_end:0:0:coarse").block());
        assertFalse(ClickIntervalMapFabric.isKnownEmpty(coarse.get("minecraft:the_end:0:0:coarse")));
    }

    @Test
    void mixedLegacyMigrationKeepsConfirmedVoidInvisibleAndCompleted() throws Exception {
        var empty = decode("minecraft:the_end", LevelHeightAccessor.create(0, 256), fullVoid()).coarse();
        var provisionalStone = new ClickIntervalMapFabric.TerrainCell("minecraft:the_end", 16, 0, 70,
                "#808080", "minecraft:stone", 16);
        var ordinaryDetailedAir = new ClickIntervalMapFabric.TerrainCell("minecraft:the_end", 20, 0, 0,
                "", "minecraft:air", 4);
        var write = ClickIntervalMapFabric.class.getDeclaredMethod("writeTerrainCache", Path.class, List.class, String.class);
        write.setAccessible(true);
        write.invoke(null, temporary, List.of(empty, provisionalStone, ordinaryDetailedAir), "# click-interval-map-cache-v2");
        var mod = new ClickIntervalMapFabric();
        var directory = ClickIntervalMapFabric.class.getDeclaredField("outputDirectory");
        directory.setAccessible(true);
        directory.set(mod, temporary);
        var load = ClickIntervalMapFabric.class.getDeclaredMethod("loadTerrainCache");
        load.setAccessible(true);
        load.invoke(mod);
        assertEquals(empty, cells(mod, "coarseTerrain").get("minecraft:the_end:0:0:coarse"));
        var provisional = ClickIntervalMapFabric.class.getDeclaredField("provisionalCoarseChunks");
        provisional.setAccessible(true);
        assertEquals(java.util.Set.of("minecraft:the_end:1:0"), provisional.get(mod));
        StringBuilder json = new StringBuilder();
        ClickIntervalMapFabric.appendTerrainJson(json, List.copyOf(cells(mod, "coarseTerrain").values()));
        var rendered = com.google.gson.JsonParser.parseString("[" + json + "]").getAsJsonArray();
        assertEquals(1, rendered.size());
        assertEquals("minecraft:stone", rendered.get(0).getAsJsonArray().get(5).getAsString());
        var detailedAir = cells(mod, "terrain").get("minecraft:the_end:20:0");
        assertEquals(TerrainColorPalette.colorFor("minecraft:air", ""), detailedAir.color());
        assertFalse(ClickIntervalMapFabric.isKnownEmpty(detailedAir));
    }

    @Test
    @SuppressWarnings("unchecked")
    void lateSavedVoidCannotEraseLiveTerrainThatWasFormerlyProvisional() throws Exception {
        var mod = new ClickIntervalMapFabric();
        var oldSurface = new ClickIntervalMapFabric.TerrainCell("minecraft:the_end", 0, 0, 65,
                "#808080", "minecraft:stone", 16);
        cells(mod, "coarseTerrain").put("minecraft:the_end:0:0:coarse", oldSurface);
        var provisional = ClickIntervalMapFabric.class.getDeclaredField("provisionalCoarseChunks");
        provisional.setAccessible(true);
        var provisionalSet = (java.util.Set<String>) provisional.get(mod);
        provisionalSet.add("minecraft:the_end:0:0");
        // Even an unchanged coarse value must clear old provisional status after a live scan.
        cells(mod, "terrain").put("minecraft:the_end:8:8", new ClickIntervalMapFabric.TerrainCell(
                "minecraft:the_end", 8, 8, 65, "#808080", "minecraft:stone", 4));
        var resample = ClickIntervalMapFabric.class.getDeclaredMethod("updateCoarseFromLoadedSamples", String.class, int.class, int.class);
        resample.setAccessible(true);
        resample.invoke(mod, "minecraft:the_end", 0, 0);
        assertTrue(provisionalSet.isEmpty());
        var result = decode("minecraft:the_end", LevelHeightAccessor.create(0, 256), fullVoid());
        var apply = ClickIntervalMapFabric.class.getDeclaredMethod("applyHistoricalSurface", ClickIntervalMapFabric.HistoricalSurface.class);
        apply.setAccessible(true);
        apply.invoke(mod, result);
        assertEquals(oldSurface, cells(mod, "coarseTerrain").get("minecraft:the_end:0:0:coarse"));
        assertFalse(cells(mod, "terrain").isEmpty());
    }

    @Test
    @EnabledIfSystemProperty(named = "map.auditWorldRoot", matches = ".+")
    void readsActualSavedEndVoidAndIslandReadOnly() throws Exception {
        Path region = Path.of(System.getProperty("map.auditWorldRoot"))
                .resolve("dimensions/minecraft/the_end/region/r.0.0.mca");
        int checked = 0;
        boolean foundVoid = false;
        boolean foundIsland = false;
        // Hard cap 64 stored chunks; open mode 'r' cannot modify the live world or generate chunks.
        try (var file = new RandomAccessFile(region.toFile(), "r")) {
            for (int slot = 0; slot < 1024 && checked < 64 && !(foundVoid && foundIsland); slot++) {
                file.seek(slot * 4L);
                int location = file.readInt();
                int sector = location >>> 8;
                if (sector < 2 || (location & 255) == 0) continue;
                file.seek(sector * 4096L);
                int length = file.readInt() - 1;
                int compression = file.readUnsignedByte();
                if (length <= 0 || length > 16_777_216 || compression < 1 || compression > 3) continue;
                byte[] encoded = new byte[length];
                file.readFully(encoded);
                var bytes = new ByteArrayInputStream(encoded);
                try (var input = new DataInputStream(compression == 2 ? new InflaterInputStream(bytes)
                        : compression == 1 ? new GZIPInputStream(bytes) : bytes)) {
                    var stored = NbtIo.read(input, NbtAccounter.create(16_777_216L));
                    checked++;
                    if (!"minecraft:full".equals(stored.getStringOr("Status", ""))) continue;
                    boolean rawAir = stored.getListOrEmpty("sections").compoundStream()
                            .filter(s -> s.getByteOr("Y", (byte) -1) >= 0 && s.getByteOr("Y", (byte) -1) < 16)
                            .allMatch(s -> s.getCompoundOrEmpty("block_states").getListOrEmpty("palette")
                                    .compoundStream().allMatch(p -> "minecraft:air".equals(p.getStringOr("Name", ""))));
                    var result = decode("minecraft:the_end", LevelHeightAccessor.create(0, 256), stored);
                    assertNotNull(result, "Actual full saved End chunk " + stored.getIntOr("xPos", 0)
                            + "," + stored.getIntOr("zPos", 0) + " must complete on first read");
                    if (rawAir) {
                        assertTrue(ClickIntervalMapFabric.isKnownEmpty(result.coarse()));
                        assertTrue(result.details().isEmpty());
                        foundVoid = true;
                    } else {
                        assertFalse(ClickIntervalMapFabric.isKnownEmpty(result.coarse()));
                        foundIsland = true;
                    }
                }
            }
        }
        assertTrue(foundVoid, "Bounded real-world sample must include a full void chunk");
        assertTrue(foundIsland, "Bounded real-world sample must include a solid island chunk");
        System.out.println("Real saved End NBT read-only: " + checked + " chunks, full void and solid island passed");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, ClickIntervalMapFabric.TerrainCell> cells(ClickIntervalMapFabric mod, String name) throws Exception {
        var field = ClickIntervalMapFabric.class.getDeclaredField(name);
        field.setAccessible(true);
        return (Map<String, ClickIntervalMapFabric.TerrainCell>) field.get(mod);
    }

    private static CompoundTag fullVoid() {
        var stored = chunk(0, "minecraft:air", null);
        stored.putInt("yPos", 0);
        var sections = new ListTag();
        for (int y = 0; y < 16; y++) sections.add(chunk(y, "minecraft:air", null)
                .getListOrEmpty("sections").getCompoundOrEmpty(0));
        stored.put("sections", sections);
        return stored;
    }

    private static ClickIntervalMapFabric.HistoricalSurface decode(String dimension, LevelHeightAccessor bounds,
                                                                   CompoundTag stored) throws Exception {
        var copied = ClickIntervalMapFabric.historicalHeightAccessor(bounds);
        var context = new ClickIntervalMapFabric.HistoricalDimension(null, copied, containers, null, dimension,
                0, 0, -100, 100, -100, 100, 0);
        return ClickIntervalMapFabric.historicalSurface(new ClickIntervalMapFabric.HistoricalChunk(context,
                stored.getIntOr("xPos", 0), stored.getIntOr("zPos", 0), 0), roundTrip(stored));
    }

    private static CompoundTag chunk(int sectionY, String block, long[] heightmap) {
        var stored = new CompoundTag();
        stored.putInt("DataVersion", SharedConstants.getCurrentVersion().dataVersion().version());
        stored.putInt("xPos", 0);
        stored.putInt("zPos", 0);
        stored.putInt("yPos", -4);
        stored.putString("Status", "minecraft:full");
        var section = new CompoundTag();
        section.putByte("Y", (byte) sectionY);
        var blockStates = new CompoundTag();
        var palette = new ListTag();
        var entry = new CompoundTag();
        entry.putString("Name", block);
        palette.add(entry);
        blockStates.put("palette", palette);
        section.put("block_states", blockStates);
        var biome = new CompoundTag();
        var biomePalette = new ListTag();
        biomePalette.add(StringTag.valueOf("minecraft:plains"));
        biome.put("palette", biomePalette);
        section.put("biomes", biome);
        var sections = new ListTag();
        sections.add(section);
        stored.put("sections", sections);
        var heights = new CompoundTag();
        if (heightmap != null) heights.putLongArray("WORLD_SURFACE", heightmap);
        stored.put("Heightmaps", heights);
        return stored;
    }

    private static CompoundTag roundTrip(CompoundTag stored) throws Exception {
        var bytes = new ByteArrayOutputStream();
        NbtIo.writeCompressed(stored, bytes);
        return NbtIo.readCompressed(new ByteArrayInputStream(bytes.toByteArray()), NbtAccounter.create(1_048_576L));
    }
}
