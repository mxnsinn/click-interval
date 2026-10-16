package dev.serverteleport.fabric.core;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.HashMap;
import java.util.Map;

/** Read-only Anvil header inspection. Call off the server thread; errors reject the area. */
public final class UnexploredRegionCheck {
    private UnexploredRegionCheck() { }

    public static boolean clear(Path directory, int chunkX, int chunkZ, int radius) {
        if (radius < 0 || radius > 8) return false;
        Map<Path, ByteBuffer> headers = new HashMap<>();
        try {
            for (int x = chunkX - radius; x <= chunkX + radius; x++) {
                for (int z = chunkZ - radius; z <= chunkZ + radius; z++) {
                    Path file = directory.resolve("r." + Math.floorDiv(x, 32) + "." + Math.floorDiv(z, 32) + ".mca");
                    if (!headers.containsKey(file)) {
                        ByteBuffer header = ByteBuffer.allocate(4096);
                        if (!Files.notExists(file)) {
                            try (FileChannel channel = FileChannel.open(file, StandardOpenOption.READ)) {
                                if (channel.size() < 8192) return false;
                                while (header.hasRemaining()) if (channel.read(header) <= 0) return false;
                            }
                        }
                        headers.put(file, header);
                    }
                    if (headers.get(file).getInt(4 * (Math.floorMod(x, 32) + 32 * Math.floorMod(z, 32))) != 0)
                        return false;
                }
            }
            return true;
        } catch (IOException | SecurityException error) {
            return false;
        }
    }
}
