package com.clickinterval.anticheat.core;

public enum EnforcementAction {
    NONE("detect"),
    ALERT("alert"),
    KICK("kick"),
    TEMP_BAN("temp_ban"),
    PERMANENT_BAN("permanent_ban");

    private final String wireName;

    EnforcementAction(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }
}
