package dev.serverenchantments.fabric.core;

import java.util.ArrayList;
import java.util.List;

public final class WideStrip {
    public enum Axis { X, Y, Z }
    private WideStrip() { }
    /** Level I: three total blocks, one on either side of the manually broken center. */
    public static List<TreeScan.Point> extras(TreeScan.Point center, boolean alongX) {
        return List.of(offset(center, -1, alongX), offset(center, 1, alongX));
    }
    /** Level II: a 3x3 plane perpendicular to the hit face, excluding its mined center. */
    public static List<TreeScan.Point> extras(TreeScan.Point center, Axis faceAxis, boolean alongX, int level) {
        if (level < 2) return extras(center, alongX);
        List<TreeScan.Point> result = new ArrayList<>(8);
        // Adjacent row first, then the other two rows; deterministic order also makes
        // protection cancellation and a nearly broken tool stop at a predictable block.
        for (int row : new int[]{0, -1, 1}) for (int column = -1; column <= 1; column++) {
            if (row == 0 && column == 0) continue;
            result.add(switch (faceAxis) {
                case X -> center.offset(0, row, column);
                case Y -> center.offset(column, 0, row);
                case Z -> center.offset(column, row, 0);
            });
        }
        return List.copyOf(result);
    }
    private static TreeScan.Point offset(TreeScan.Point center, int amount, boolean x) {
        return center.offset(x ? amount : 0, 0, x ? 0 : amount);
    }
}
