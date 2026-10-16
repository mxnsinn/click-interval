package dev.serverenchantments.fabric.core;

import java.util.*;
import java.util.function.Function;

/** Incremental complete-plan discovery. Never returns a partial oversized/unloaded tree. */
public final class TreeScan {
    public record Point(int x, int y, int z) { public Point offset(int x, int y, int z) { return new Point(this.x+x,this.y+y,this.z+z); } }
    public enum Kind { OTHER, LOG, ROOTED_LOG, NATURAL_LEAF, UNAVAILABLE }
    private final Point origin;
    private final int limit;
    private final ArrayDeque<Point> pending = new ArrayDeque<>();
    private final Set<Point> visited = new HashSet<>();
    private final List<Point> logs = new ArrayList<>();
    private int leaves;
    private boolean rooted;
    private boolean failed;

    public TreeScan(Point origin, int limit, boolean rootedOrigin) {
        this.origin = origin;
        this.limit = Math.max(1, Math.min(128, limit));
        rooted = rootedOrigin;
        visited.add(origin);
        neighbors(origin);
    }
    public int step(int budget, Function<Point, Kind> inspect) {
        int used = 0;
        while (!failed && !pending.isEmpty() && used < budget) {
            Point point = pending.removeFirst();
            Kind kind = inspect.apply(point);
            used++;
            if (kind == Kind.UNAVAILABLE) { failed = true; break; }
            if (kind == Kind.NATURAL_LEAF) { leaves++; continue; }
            if (kind != Kind.LOG && kind != Kind.ROOTED_LOG) continue;
            if (logs.size() + 1 >= limit || Math.abs(point.x-origin.x)>12 ||
                    Math.abs(point.z-origin.z)>12 || point.y<origin.y-8 || point.y>origin.y+40) {
                failed = true;
                break;
            }
            logs.add(point);
            if (kind == Kind.ROOTED_LOG) rooted = true;
            neighbors(point);
        }
        return used;
    }
    private void neighbors(Point point) {
        for (int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++) {
            if (x==0 && y==0 && z==0) continue;
            Point adjacent = point.offset(x,y,z);
            if (visited.add(adjacent)) pending.addLast(adjacent);
        }
    }
    public boolean finished() { return failed || pending.isEmpty(); }
    public boolean valid() { return finished() && !failed && rooted && leaves >= 4 && !logs.isEmpty(); }
    public List<Point> plan() { return valid() ? List.copyOf(logs) : List.of(); }
}
