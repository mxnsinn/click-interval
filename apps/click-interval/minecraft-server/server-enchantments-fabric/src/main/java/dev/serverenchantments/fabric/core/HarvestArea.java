package dev.serverenchantments.fabric.core;

import java.util.ArrayList;
import java.util.List;

/** Fixed horizontal farm geometry; never scans outside at most 25 cells. */
public final class HarvestArea {
    private HarvestArea() { }

    public static List<TreeScan.Point> extras(TreeScan.Point origin, boolean alongX, int level) {
        if (level < 1) return List.of();
        List<TreeScan.Point> result = new ArrayList<>(24);
        if (level == 1) {
            result.add(new TreeScan.Point(origin.x() - (alongX ? 1 : 0), origin.y(), origin.z() - (alongX ? 0 : 1)));
            result.add(new TreeScan.Point(origin.x() + (alongX ? 1 : 0), origin.y(), origin.z() + (alongX ? 0 : 1)));
        } else {
            int radius = level >= 3 ? 2 : 1;
            for (int z = -radius; z <= radius; z++) for (int x = -radius; x <= radius; x++) {
                if (x != 0 || z != 0) result.add(new TreeScan.Point(origin.x() + x, origin.y(), origin.z() + z));
            }
        }
        return List.copyOf(result);
    }
}
