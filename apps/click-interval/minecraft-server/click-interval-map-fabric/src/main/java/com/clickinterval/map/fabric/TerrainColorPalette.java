package com.clickinterval.map.fabric;

import java.util.Locale;
import java.util.List;
import java.util.Map;

/** Stable colors for stored chunks, with Minecraft's own map color preferred for live chunks. */
final class TerrainColorPalette {
    private static final Map<String, String> DYE_COLORS = Map.ofEntries(
            Map.entry("white", "#e6e8e8"), Map.entry("orange", "#e87f24"),
            Map.entry("magenta", "#b24cd8"), Map.entry("light_blue", "#669dd8"),
            Map.entry("yellow", "#d8bd32"), Map.entry("lime", "#72b936"),
            Map.entry("pink", "#d889a8"), Map.entry("gray", "#4b5257"),
            Map.entry("light_gray", "#9ba2a2"), Map.entry("cyan", "#27919a"),
            Map.entry("purple", "#803fb2"), Map.entry("blue", "#3659a8"),
            Map.entry("brown", "#724728"), Map.entry("green", "#4c7729"),
            Map.entry("red", "#a83b32"), Map.entry("black", "#25272b")
    );
    private static final List<String> DYE_MATCH_ORDER = List.of(
            "light_blue", "light_gray", "white", "orange", "magenta", "yellow", "lime", "pink",
            "gray", "cyan", "purple", "blue", "brown", "green", "red", "black");

    private TerrainColorPalette() {}

    static String colorFor(String block, String biome) {
        return colorFor(block, biome, -1);
    }

    static String colorFor(String block, String biome, int minecraftMapColor) {
        String id = String.valueOf(block).toLowerCase(Locale.ROOT);
        String area = String.valueOf(biome).toLowerCase(Locale.ROOT);

        if (id.contains("water")) return water(area);
        if (id.contains("lava") || id.contains("magma")) return id.contains("magma") ? "#9a3e1f" : "#ef6428";
        if (id.contains("ice")) return id.contains("packed") ? "#78acd6" : id.contains("blue_ice") ? "#4f79c9" : "#a7d8ed";
        if (id.contains("snow")) return "#eef3f5";

        if (id.endsWith(":grass_block") || id.endsWith(":short_grass") || id.endsWith(":tall_grass")) {
            return vegetation(area, false);
        }
        if (id.contains("cherry_leaves")) return "#d58fa8";
        if (id.contains("leaves") || id.contains("vine") || id.contains("moss")
                || id.contains("azalea") || id.contains("lily_pad")) return vegetation(area, true);
        if (id.contains("flower") || id.contains("tulip") || id.contains("orchid")
                || id.contains("dandelion") || id.contains("poppy") || id.contains("allium")) return "#84a84c";
        if (id.contains("wheat") || id.contains("hay_block")) return "#b89a3d";
        if (id.contains("crop") || id.contains("carrot") || id.contains("potato") || id.contains("beetroot")) return "#69943d";

        String dyed = dyedColor(id);
        if (dyed != null) return dyed;
        if (minecraftMapColor > 0) return String.format(Locale.ROOT, "#%06x", minecraftMapColor & 0x00ff_ffff);

        if (id.contains("sand") || id.contains("sandstone")) return id.contains("red_") ? "#b7653c" : "#d8c581";
        if (id.contains("gravel")) return "#837f78";
        if (id.contains("clay")) return "#9da7ad";
        if (id.contains("mud")) return "#51483e";
        if (id.contains("podzol")) return "#6c4d2f";
        if (id.contains("mycelium")) return "#765f73";
        if (id.contains("dirt") || id.contains("farmland")) return "#795238";

        if (id.contains("cherry")) return id.contains("leaves") ? "#d58fa8" : "#ba8490";
        if (id.contains("mangrove")) return id.contains("leaves") ? "#4d7540" : "#6b3f32";
        if (id.contains("birch")) return "#c5b88a";
        if (id.contains("acacia")) return "#a55d38";
        if (id.contains("dark_oak")) return "#4f3825";
        if (id.contains("spruce")) return "#67503a";
        if (id.contains("jungle")) return "#8b673d";
        if (id.contains("oak") || id.contains("log") || id.contains("wood") || id.contains("planks")) return "#8b6841";

        if (id.contains("prismarine")) return id.contains("dark_") ? "#315e58" : "#65a89b";
        if (id.contains("sea_lantern")) return "#c7d9c3";
        if (id.contains("coral")) return coral(id);
        if (id.contains("kelp") || id.contains("seagrass")) return "#3f7651";

        if (id.contains("copper")) {
            if (id.contains("oxidized")) return "#4d9b83";
            if (id.contains("weathered")) return "#67927b";
            if (id.contains("exposed")) return "#a57455";
            return "#bd6f4a";
        }
        if (id.contains("gold")) return "#d9b635";
        if (id.contains("diamond")) return "#55c7bd";
        if (id.contains("emerald")) return "#39a85b";
        if (id.contains("lapis")) return "#345bb0";
        if (id.contains("redstone")) return "#a62c28";
        if (id.contains("amethyst")) return "#8e62b8";
        if (id.contains("iron")) return "#b6aaa0";
        if (id.contains("coal")) return "#454647";

        if (id.contains("netherrack") || id.contains("nether_wart")) return "#7e3737";
        if (id.contains("crimson")) return "#7d3148";
        if (id.contains("warped")) return "#247d78";
        if (id.contains("soul_sand") || id.contains("soul_soil")) return "#58473a";
        if (id.contains("basalt")) return "#4a484d";
        if (id.contains("blackstone")) return "#36343b";
        if (id.contains("glowstone")) return "#d69b54";
        if (id.contains("quartz")) return "#e2ddd5";

        if (id.contains("end_stone")) return "#d8d39a";
        if (id.contains("purpur")) return "#a96ba7";
        if (id.contains("obsidian")) return "#29213a";
        if (id.contains("bedrock")) return "#4a4a4a";
        if (id.contains("deepslate")) return "#505154";
        if (id.contains("tuff")) return "#666d67";
        if (id.contains("calcite")) return "#ddd9cc";
        if (id.contains("granite")) return "#936957";
        if (id.contains("diorite")) return "#b9b8b3";
        if (id.contains("andesite")) return "#858684";
        if (id.contains("stone") || id.contains("ore")) return "#777b7c";
        if (id.contains("air")) return "#20242a";
        return "#888b84";
    }

    private static String water(String biome) {
        if (biome.contains("warm_ocean")) return "#2d8bba";
        if (biome.contains("frozen") || biome.contains("cold_ocean")) return "#3c70a4";
        if (biome.contains("swamp")) return "#4d765d";
        if (biome.contains("river")) return "#397fc1";
        return "#3478b8";
    }

    private static String vegetation(String biome, boolean foliage) {
        if (biome.contains("swamp") || biome.contains("mangrove")) return foliage ? "#526f3d" : "#607a45";
        if (biome.contains("jungle") || biome.contains("bamboo")) return foliage ? "#2f7d39" : "#3d913f";
        if (biome.contains("badlands") || biome.contains("desert")) return "#8b9a45";
        if (biome.contains("savanna")) return foliage ? "#6f8842" : "#8a9b46";
        if (biome.contains("dark_forest")) return "#355f35";
        if (biome.contains("taiga") || biome.contains("snow")) return foliage ? "#52745b" : "#668454";
        return foliage ? "#4d8a43" : "#63a54d";
    }

    private static String dyedColor(String id) {
        if (!(id.contains("wool") || id.contains("concrete") || id.contains("terracotta")
                || id.contains("stained_glass") || id.contains("glazed_terracotta"))) return null;
        for (String name : DYE_MATCH_ORDER) {
            if (id.contains(':' + name + '_')) return DYE_COLORS.get(name);
        }
        return id.contains("terracotta") ? "#985f48" : null;
    }

    private static String coral(String id) {
        if (id.contains("tube")) return "#315bc3";
        if (id.contains("brain")) return "#cc5aa4";
        if (id.contains("bubble")) return "#9b4fc0";
        if (id.contains("fire")) return "#c73f38";
        if (id.contains("horn")) return "#d3bd3b";
        return "#77756f";
    }
}
