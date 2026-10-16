package dev.serverprotection.fabric;

/** One exact extra PosRot per server-issued, vanilla-acknowledged correction; never a rate reset. */
public final class MovementCorrectionTracker {
    private static final long ISSUE_TIMEOUT_MS = 2_000;
    private static final long RESPONSE_TIMEOUT_MS = 250;
    private boolean pending, acknowledged;
    private int id;
    private long issuedAt, acknowledgedAt;
    private double x, y, z;
    private float yaw, pitch;

    public void issued(long now, int teleportId, double x, double y, double z, float yaw, float pitch) {
        reset();
        if (!finite(x,y,z,yaw,pitch)) return;
        this.pending = true; this.id = teleportId; this.issuedAt = now;
        this.x = x; this.y = y; this.z = z; this.yaw = yaw; this.pitch = pitch;
    }

    /** Caller invokes this only after vanilla has accepted the outstanding teleport ID. */
    public void acknowledged(long now, int teleportId) {
        if (!pending || acknowledged || teleportId != id) return;
        if (!within(now,issuedAt,ISSUE_TIMEOUT_MS)) { reset(); return; }
        acknowledged = true; acknowledgedAt = now;
    }

    public boolean consume(long now, boolean posRot, boolean onGround, boolean horizontalCollision,
                           double x, double y, double z, float yaw, float pitch) {
        if (!pending) return false;
        if (!within(now,issuedAt,ISSUE_TIMEOUT_MS)) { reset(); return false; }
        if (!acknowledged) return false;
        // Only the first movement packet after the validated ACK can be its immediate response.
        // Mismatch also consumes the token: it cannot be saved for a replay later.
        boolean matches = within(now,acknowledgedAt,RESPONSE_TIMEOUT_MS)
                && posRot && !onGround && !horizontalCollision && finite(x,y,z,yaw,pitch)
                && Math.abs(x-this.x) <= 1.0e-6 && Math.abs(y-this.y) <= 1.0e-6 && Math.abs(z-this.z) <= 1.0e-6
                && rotationDistance(yaw,this.yaw) <= 0.001 && rotationDistance(pitch,this.pitch) <= 0.001;
        reset();
        return matches;
    }

    public void reset() { pending=false; acknowledged=false; }
    private static boolean within(long now,long start,long duration) {return now>=start&&now-start<=duration;}
    private static boolean finite(double x,double y,double z,float yaw,float pitch) {
        return Double.isFinite(x)&&Double.isFinite(y)&&Double.isFinite(z)&&Float.isFinite(yaw)&&Float.isFinite(pitch);
    }
    private static double rotationDistance(float first,float second) {
        double delta=((double)first-second)%360.0;
        if(delta>180)delta-=360;if(delta< -180)delta+=360;
        return Math.abs(delta);
    }
}
