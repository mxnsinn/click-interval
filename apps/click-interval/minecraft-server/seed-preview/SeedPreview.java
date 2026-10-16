package com.clickinterval.map.preview;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.Registries;
import net.minecraft.data.registries.VanillaRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.biome.*;
import net.minecraft.world.level.levelgen.*;

/** Read-only native biome sampling. Never creates a server, chunk, level, or save. */
public final class SeedPreview {
    private static final Gson JSON = new Gson();
    private static final PrintStream OUTPUT = System.out;
    private static HolderLookup.Provider registries;
    private static String cachedKey = "";
    private static BiomeSource source;
    private static RandomState random;

    public static void main(String[] args) throws Exception {
        System.setOut(System.err);
        SharedConstants.tryDetectVersion();
        if (!SharedConstants.getCurrentVersion().name().equals("26.2")) throw new IllegalStateException("Version mismatch");
        Bootstrap.bootStrap();
        registries = VanillaRegistries.createLookup();
        OUTPUT.println("READY");
        try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = input.readLine()) != null) {
                if (line.length() > 8192) break;
                try { OUTPUT.println(JSON.toJson(sample(JsonParser.parseString(line).getAsJsonObject()))); }
                catch (Exception error) { OUTPUT.println("{\"error\":\"Invalid seed preview request\"}"); }
            }
        }
    }

    private static JsonObject sample(JsonObject request) throws Exception {
        String seedText = request.get("seed").getAsString();
        long seed = Long.parseLong(seedText);
        String dimension = request.get("dimension").getAsString();
        String generator = request.get("generator").getAsString();
        String key = seedText + ":" + dimension + ":" + generator;
        if (!key.equals(cachedKey)) {
            var settings = switch (dimension) {
                case "minecraft:overworld" -> switch (generator) {
                    case "minecraft:overworld" -> NoiseGeneratorSettings.OVERWORLD;
                    case "minecraft:large_biomes" -> NoiseGeneratorSettings.LARGE_BIOMES;
                    case "minecraft:amplified" -> NoiseGeneratorSettings.AMPLIFIED;
                    default -> throw new IllegalArgumentException();
                };
                case "minecraft:the_nether" -> NoiseGeneratorSettings.NETHER;
                case "minecraft:the_end" -> NoiseGeneratorSettings.END;
                default -> throw new IllegalArgumentException();
            };
            random = RandomState.create(registries, settings, seed);
            source = dimension.equals("minecraft:the_end")
                ? TheEndBiomeSource.create(registries.lookupOrThrow(Registries.BIOME))
                : MultiNoiseBiomeSource.createFromPreset(registries.getOrThrow(dimension.equals("minecraft:the_nether")
                    ? MultiNoiseBiomeSourceParameterLists.NETHER : MultiNoiseBiomeSourceParameterLists.OVERWORLD));
            cachedKey = key;
        }
        int startX = request.get("x").getAsInt(), startZ = request.get("z").getAsInt();
        int width = request.get("width").getAsInt(), height = request.get("height").getAsInt(), step = request.get("step").getAsInt();
        if (width < 1 || height < 1 || width > 128 || height > 128 || width * height > 4096
                || step < 4 || step > 1048576 || Integer.bitCount(step) != 1
                || Math.abs((long) startX) > 30000000 || Math.abs((long) startZ) > 30000000
                || Math.abs((long) startX + (long) width * step) > 31048576
                || Math.abs((long) startZ + (long) height * step) > 31048576) throw new IllegalArgumentException();
        JsonArray biomes = new JsonArray();
        long start = System.nanoTime();
        for (int z = 0; z < height; z++) {
            long rowStart = System.nanoTime();
            for (int x = 0; x < width; x++) {
                int bx = startX + x * step + step / 2, bz = startZ + z * step + step / 2;
                biomes.add(source.getNoiseBiome(Math.floorDiv(bx, 4), 16, Math.floorDiv(bz, 4), random.sampler())
                    .unwrapKey().orElseThrow().identifier().toString());
            }
            // A single low-priority worker gets at most a quarter of one CPU while sampling.
            long rowNanos = System.nanoTime() - rowStart;
            Thread.sleep(Math.min(30L, Math.max(1L, rowNanos * 3L / 1_000_000L)));
        }
        JsonObject result = new JsonObject();
        result.add("biomes", biomes);
        result.addProperty("sampleY", 64);
        result.addProperty("sampleMillis", (System.nanoTime() - start) / 1_000_000L);
        return result;
    }
}
