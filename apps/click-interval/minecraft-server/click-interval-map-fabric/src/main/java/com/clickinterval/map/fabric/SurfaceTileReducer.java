package com.clickinterval.map.fabric;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Reduces a fixed set of surface probes without retaining block or chunk objects. */
final class SurfaceTileReducer {
    private SurfaceTileReducer() {}

    static Result reduce(List<Sample> samples, int detailSize) {
        if (samples == null || samples.isEmpty()) return null;
        if (detailSize <= 0 || detailSize > 16 || 16 % detailSize != 0) {
            throw new IllegalArgumentException("detailSize must divide a 16-block chunk");
        }

        Cell coarse = representative(samples, 0, 0, 16);
        if (coarse == null) return null;

        List<Cell> details = new ArrayList<>((16 / detailSize) * (16 / detailSize));
        for (int z = 0; z < 16; z += detailSize) {
            for (int x = 0; x < 16; x += detailSize) {
                Cell detail = representative(samples, x, z, detailSize);
                if (detail != null) details.add(detail);
            }
        }
        return new Result(coarse, List.copyOf(details));
    }

    private static Cell representative(List<Sample> samples, int originX, int originZ, int size) {
        Map<String, Candidate> candidates = new LinkedHashMap<>();
        int endX = originX + size;
        int endZ = originZ + size;
        for (Sample sample : samples) {
            if (sample.localX < originX || sample.localX >= endX
                    || sample.localZ < originZ || sample.localZ >= endZ) continue;
            String key = sample.color + '\u0000' + sample.block;
            Candidate previous = candidates.get(key);
            if (previous == null) {
                candidates.put(key, new Candidate(sample, 1));
            } else {
                Sample representative = sample.y > previous.sample.y ? sample : previous.sample;
                candidates.put(key, new Candidate(representative, previous.count + 1));
            }
        }

        Candidate selected = null;
        for (Candidate candidate : candidates.values()) {
            if (selected == null
                    || candidate.count > selected.count
                    || (candidate.count == selected.count && candidate.sample.y > selected.sample.y)
                    || (candidate.count == selected.count && candidate.sample.y == selected.sample.y
                    && candidate.sample.block.compareTo(selected.sample.block) < 0)) {
                selected = candidate;
            }
        }
        if (selected == null) return null;
        return new Cell(originX, originZ, selected.sample.y,
                selected.sample.color, selected.sample.block, size);
    }

    record Sample(int localX, int localZ, int y, String color, String block) {}
    record Cell(int localX, int localZ, int y, String color, String block, int size) {}
    record Result(Cell coarse, List<Cell> details) {}
    private record Candidate(Sample sample, int count) {}
}
