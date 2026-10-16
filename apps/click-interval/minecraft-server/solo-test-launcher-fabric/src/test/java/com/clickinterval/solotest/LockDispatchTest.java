package com.clickinterval.solotest;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LockDispatchTest {
    @Test void permitsOnlyKnownDimensionActions() {
        assertEquals("endlock on",LockDispatch.command("endlock","on",null));
        assertEquals("netherlock off",LockDispatch.command("netherlock","off",""));
        assertEquals("endlock status",LockDispatch.command("endlock","status",null));
        assertThrows(IllegalArgumentException.class,()->LockDispatch.command("stop","on",null));
        assertThrows(IllegalArgumentException.class,()->LockDispatch.command("endlock","eyes",null));
        assertThrows(IllegalArgumentException.class,()->LockDispatch.command("endlock","on","1d"));
    }
    @Test void validatesDurationUnitsAndBounds() {
        for(String duration:new String[]{"1s","30s","10m","2h","1d","365d","31536000s"})
            assertEquals("endlock for "+duration,LockDispatch.command("endlock","for",duration));
        for(String invalid:new String[]{"0s","-1d","366d","31536001s","1.5h","1 day","1d\nstop","1d;stop","1d /stop","999999999d","01d","1D","", "1h30m"})
            assertThrows(IllegalArgumentException.class,()->LockDispatch.command("netherlock","for",invalid),invalid);
    }
    @Test void settingsDispatchRetainsHostGuardsAndNativePermissions() throws Exception {
        String code;
        try(var stream=getClass().getResourceAsStream("/com/clickinterval/solotest/TestSettingsScreen.class")) {
            code=new String(stream.readAllBytes(),java.nio.charset.StandardCharsets.ISO_8859_1);
        }
        for(String required:new String[]{"permitted","createCommandSourceStack","withCallback","performPrefixedCommand","getSingleplayerServer","LockDispatch","ALLOW_GAME"}) assertTrue(code.contains(required),required);
        for(String forbidden:new String[]{"withSource","withPermission","withMaximumPermission","ALL_PERMISSIONS","sendCommand","sendChat","publishServer","stopServer","glfwFocusWindow"}) assertFalse(code.contains(forbidden),forbidden);
    }
}
