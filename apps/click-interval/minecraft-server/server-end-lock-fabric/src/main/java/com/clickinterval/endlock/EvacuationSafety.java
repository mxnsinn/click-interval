package com.clickinterval.endlock;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import java.util.Set;

/** All inspection is loaded-only. No chunk generation, terrain edits, guessed coordinates or unsafe teleports. */
final class EvacuationSafety {
    private static final Set<String> HAZARDS = Set.of("lava", "water", "fire", "soul_fire", "magma_block",
            "campfire", "soul_campfire", "cactus", "sweet_berry_bush", "wither_rose", "powder_snow",
            "pointed_dripstone", "nether_portal", "end_portal", "end_gateway");

    static boolean originNeighborhoodLoaded(ServerLevel level, Vec3 origin) {
        int cx = ((int) Math.floor(origin.x)) >> 4, cz = ((int) Math.floor(origin.z)) >> 4;
        for (int x = cx - 1; x <= cx + 1; x++) for (int z = cz - 1; z <= cz + 1; z++) {
            if (level.getChunkSource().getChunkNow(x, z) == null) return false;
        }
        return true;
    }

    static boolean safe(ServerLevel level, ServerPlayer player, Vec3 feet) {
        if (!Double.isFinite(feet.x) || !Double.isFinite(feet.y) || !Double.isFinite(feet.z)) return false;
        var standing = player.getDimensions(Pose.STANDING);
        double halfWidth = Math.max(standing.width(), player.getBbWidth()) / 2.0;
        double height = Math.max(standing.height(), player.getBbHeight());
        // Preserve bounded work even if a mod supplies an extreme scale; never squeeze a large player into a normal gap.
        if (!Double.isFinite(halfWidth) || !Double.isFinite(height) || halfWidth > 8 || height > 16) return false;
        AABB body = new AABB(feet.x - halfWidth, feet.y, feet.z - halfWidth, feet.x + halfWidth, feet.y + height, feet.z + halfWidth);
        AABB inspect = body.inflate(0.15, 0, 0.15).expandTowards(0, -1, 0);
        if (inspect.minY < level.getMinY() || body.maxY >= level.getMaxY()
                || !level.getWorldBorder().isWithinBounds(inspect) || !loaded(level, inspect)
                || !level.noBlockCollision(player, body)
                || !level.getEntities(player, body, other -> other.isAlive() && other.isPickable()).isEmpty()) return false;
        for (BlockPos pos : BlockPos.betweenClosed(inspect.deflate(1.0E-7))) {
            var block = level.getBlockState(pos);
            if (!block.getFluidState().isEmpty()
                    || HAZARDS.contains(BuiltInRegistries.BLOCK.getKey(block.getBlock()).getPath())) return false;
        }
        int floorY = (int) Math.floor(feet.y - 1.0E-7);
        if (Math.abs(feet.y - (floorY + 1)) > 1.0E-5) return false;
        for (int x = (int) Math.floor(body.minX); x <= (int) Math.floor(Math.nextDown(body.maxX)); x++) {
            for (int z = (int) Math.floor(body.minZ); z <= (int) Math.floor(Math.nextDown(body.maxZ)); z++) {
                BlockPos floor = new BlockPos(x, floorY, z);
                if (!level.getBlockState(floor).isFaceSturdy(level, floor, Direction.UP)) return false;
            }
        }
        return true;
    }

    static Vec3 nearOrigin(ServerLevel level, ServerPlayer player, Vec3 origin) {
        if (safe(level, player, origin)) return origin;
        BlockPos center = BlockPos.containing(origin);
        for (int radius = 0; radius <= 3; radius++) {
            for (int x = -radius; x <= radius; x++) for (int z = -radius; z <= radius; z++) {
                if (Math.max(Math.abs(x), Math.abs(z)) != radius) continue;
                for (int y : new int[]{0, 1, -1, 2, -2}) {
                    Vec3 point = new Vec3(center.getX() + x + 0.5, center.getY() + y, center.getZ() + z + 0.5);
                    if (safe(level, player, point)) return point;
                }
            }
        }
        return null;
    }

    static Vec3 nearSpawn(ServerLevel level, ServerPlayer player, BlockPos spawn) {
        Vec3 direct = nearOrigin(level, player, Vec3.atBottomCenterOf(spawn));
        if (direct != null) return direct;
        for (int radius = 0; radius <= 8; radius++) {
            for (int dx = -radius; dx <= radius; dx++) for (int dz = -radius; dz <= radius; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) != radius) continue;
                int x = spawn.getX() + dx, z = spawn.getZ() + dz;
                var chunk = level.getChunkSource().getChunkNow(x >> 4, z >> 4);
                if (chunk == null) continue;
                Vec3 point = new Vec3(x + 0.5, chunk.getHeight(Heightmap.Types.WORLD_SURFACE, x & 15, z & 15) + 1, z + 0.5);
                if (safe(level, player, point)) return point;
            }
        }
        return null;
    }

    private static boolean loaded(ServerLevel level, AABB box) {
        for (int x = ((int) Math.floor(box.minX)) >> 4; x <= ((int) Math.floor(box.maxX)) >> 4; x++) {
            for (int z = ((int) Math.floor(box.minZ)) >> 4; z <= ((int) Math.floor(box.maxZ)) >> 4; z++) {
                if (level.getChunkSource().getChunkNow(x, z) == null) return false;
            }
        }
        return true;
    }

    private EvacuationSafety() { }
}
