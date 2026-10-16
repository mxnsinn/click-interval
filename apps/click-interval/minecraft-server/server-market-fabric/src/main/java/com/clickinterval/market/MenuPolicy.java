package com.clickinterval.market;

/** No Minecraft bootstrap needed: unit-test the allowlist, not a denylist. */
final class MenuPolicy {
    private MenuPolicy() {}
    static boolean accepts(int slot,int button,boolean pickup) { return pickup && button==0 && slot>=0 && slot<54; }
}
