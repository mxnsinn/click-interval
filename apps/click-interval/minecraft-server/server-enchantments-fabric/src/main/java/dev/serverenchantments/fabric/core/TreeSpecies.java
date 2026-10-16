package dev.serverenchantments.fabric.core;

import java.util.Set;

public final class TreeSpecies {
    private static final Set<String> LOGS = Set.of("oak_log", "spruce_log", "birch_log", "jungle_log",
            "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log");
    private TreeSpecies() { }
    public static boolean naturalLog(String namespace, String path) {
        return "minecraft".equals(namespace) && LOGS.contains(path);
    }
    public static boolean matchingNaturalLeaves(String logPath, String namespace, String path, boolean persistent) {
        return !persistent && "minecraft".equals(namespace) && LOGS.contains(logPath)
                && path.equals(logPath.substring(0,logPath.length()-4)+"_leaves");
    }
}
