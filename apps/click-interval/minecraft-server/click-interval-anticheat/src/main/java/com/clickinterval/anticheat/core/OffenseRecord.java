package com.clickinterval.anticheat.core;

import java.util.UUID;

public final class OffenseRecord {
    private static final int MAX_DETECTIONS = Integer.MAX_VALUE;
    private static final int MAX_OFFENSES = 1_000_000;
    private final UUID uuid;
    private String name;
    private int detections;
    private int offenseCount;
    private long temporaryBanUntil;
    private boolean permanentBan;
    private long lastSeenAt;
    private String lastCheck = "";
    private String lastReason = "";
    private String lastAction = "detect";

    public OffenseRecord(UUID uuid, String name) {
        this.uuid = uuid;
        this.name = bounded(name, 64);
    }

    public UUID uuid() { return uuid; }
    public String name() { return name; }
    public int detections() { return detections; }
    public int offenseCount() { return offenseCount; }
    public long temporaryBanUntil() { return temporaryBanUntil; }
    public boolean permanentBan() { return permanentBan; }
    public long lastSeenAt() { return lastSeenAt; }
    public String lastCheck() { return lastCheck; }
    public String lastReason() { return lastReason; }
    public String lastAction() { return lastAction; }

    void observe(String playerName, String check, String reason, long now) {
        name = bounded(playerName, 64);
        if (detections < MAX_DETECTIONS) detections++;
        lastCheck = bounded(check, 96);
        lastReason = bounded(reason, 512);
        lastSeenAt = now;
    }

    void punish(EnforcementAction action, long until, boolean countsAsOffense) {
        if (countsAsOffense && offenseCount < MAX_OFFENSES) offenseCount++;
        if (action == EnforcementAction.TEMP_BAN) temporaryBanUntil = Math.max(temporaryBanUntil, until);
        if (action == EnforcementAction.PERMANENT_BAN) permanentBan = true;
        lastAction = bounded(action.wireName(), 32);
    }

    boolean decayOffenses(long now, long inactiveMillis) {
        if (permanentBan || temporaryBanUntil > now || offenseCount == 0 || lastSeenAt == 0) return false;
        if (now - lastSeenAt < inactiveMillis) return false;
        offenseCount = 0;
        lastAction = "decayed";
        return true;
    }

    void pardon() {
        temporaryBanUntil = 0L;
        permanentBan = false;
        offenseCount = 0;
        lastAction = "pardoned";
    }

    void restore(
            int detections,
            int offenseCount,
            long temporaryBanUntil,
            boolean permanentBan,
            long lastSeenAt,
            String lastCheck,
            String lastReason,
            String lastAction
    ) {
        this.detections = Math.max(0, detections);
        this.offenseCount = Math.max(0, Math.min(MAX_OFFENSES, offenseCount));
        this.temporaryBanUntil = Math.max(0, temporaryBanUntil);
        this.permanentBan = permanentBan;
        this.lastSeenAt = Math.max(0, lastSeenAt);
        this.lastCheck = bounded(lastCheck, 96);
        this.lastReason = bounded(lastReason, 512);
        this.lastAction = bounded(lastAction, 32);
    }

    private static String bounded(String value, int maximum) {
        if (value == null) return "";
        if (value.length() <= maximum) return value;
        int end = maximum;
        if (Character.isHighSurrogate(value.charAt(end - 1))) end--;
        return value.substring(0, end);
    }
}
