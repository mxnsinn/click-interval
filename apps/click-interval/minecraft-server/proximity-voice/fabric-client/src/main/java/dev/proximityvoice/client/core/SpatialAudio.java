package dev.proximityvoice.client.core;

public final class SpatialAudio {
    private SpatialAudio() {}

    public static Gains gains(double listenerX, double listenerY, double listenerZ, float listenerYawDegrees,
                              double sourceX, double sourceY, double sourceZ, double radius,
                              double masterVolume, double playerVolume) {
        if (!Double.isFinite(radius) || radius <= 0) return new Gains(0, 0);
        double dx = sourceX - listenerX;
        double dy = sourceY - listenerY;
        double dz = sourceZ - listenerZ;
        double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!Double.isFinite(distance) || distance >= radius) return new Gains(0, 0);

        double normalized = Math.max(0.0, 1.0 - distance / radius);
        double attenuation = Math.pow(normalized, 1.35);
        if (distance <= 2.0) attenuation = 1.0;

        double horizontal = Math.hypot(dx, dz);
        double pan = 0.0;
        if (horizontal > 1.0e-5) {
            double yaw = Math.toRadians(listenerYawDegrees);
            double rightX = -Math.cos(yaw);
            double rightZ = -Math.sin(yaw);
            pan = clamp((dx * rightX + dz * rightZ) / horizontal, -1.0, 1.0);
        }

        double base = attenuation * clamp(masterVolume, 0, 2) * clamp(playerVolume, 0, 2);
        double left = base * Math.sqrt((1.0 - pan) * 0.5);
        double right = base * Math.sqrt((1.0 + pan) * 0.5);
        return new Gains(left, right);
    }

    public static void mixMono(short[] mono, int sampleCount, Gains gains, int[] stereoAccumulator) {
        int bounded = Math.min(sampleCount, Math.min(mono.length, stereoAccumulator.length / 2));
        for (int index = 0; index < bounded; index++) {
            stereoAccumulator[index * 2] += (int) Math.round(mono[index] * gains.left());
            stereoAccumulator[index * 2 + 1] += (int) Math.round(mono[index] * gains.right());
        }
    }

    public static byte[] toLittleEndianStereo(int[] accumulator, int frames) {
        int bounded = Math.min(frames, accumulator.length / 2);
        byte[] output = new byte[bounded * 4];
        writeLittleEndianStereo(accumulator, bounded, output);
        return output;
    }

    /** Writes into a caller-owned frame buffer so the 50 Hz playback loop does not allocate. */
    public static int writeLittleEndianStereo(int[] accumulator, int frames, byte[] output) {
        if (accumulator == null || output == null || frames < 0) {
            throw new IllegalArgumentException("Accumulator, output and a nonnegative frame count are required");
        }
        int bounded = Math.min(frames, Math.min(accumulator.length / 2, output.length / 4));
        for (int index = 0; index < bounded * 2; index++) {
            int sample = Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, accumulator[index]));
            output[index * 2] = (byte) sample;
            output[index * 2 + 1] = (byte) (sample >>> 8);
        }
        return bounded * 4;
    }

    private static double clamp(double value, double minimum, double maximum) {
        if (!Double.isFinite(value)) return minimum;
        return Math.max(minimum, Math.min(maximum, value));
    }

    public record Gains(double left, double right) {}
}
