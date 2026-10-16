package com.clickinterval.solotest;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SafetyContractTest {
    @Test void hostGateNeedsEveryGuard() {
        assertTrue(TestHub.allowed(true,true,true,true,true));
        assertFalse(TestHub.allowed(false,true,true,true,true));
        assertFalse(TestHub.allowed(true,false,true,true,true));
        assertFalse(TestHub.allowed(true,true,false,true,true));
        assertFalse(TestHub.allowed(true,true,true,false,true));
        assertFalse(TestHub.allowed(true,true,true,true,false));
    }
    @Test void clientOnlyAndNativeOpenWithoutInputOrServerControl() throws Exception {
        String metadata=new String(getClass().getResourceAsStream("/fabric.mod.json").readAllBytes(),StandardCharsets.UTF_8);
        assertTrue(metadata.contains("\"environment\": \"client\"")); assertFalse(metadata.contains("\"server\":"));
        String launcher=bytecode("SoloTestLauncher");
        for(String required:new String[]{"createWorldOpenFlows","openWorld","getSingleplayerServer","getConnection","overlay","TitleScreen","END_CLIENT_TICK"}) assertTrue(launcher.contains(required),required);
        for(String name:new String[]{"SoloTestLauncher","TestHub","TestMerchant"}) {
            String code=bytecode(name);
            for(String forbidden:new String[]{"mouseHandler","keyboardHandler","glfwSetCursorPos","glfwFocusWindow","Robot","publishServer","stopServer","disconnectWithSavingScreen","setScreenAndShow","clearContent","giveOrDrop","placeNewPlayer","addNewPlayer"})
                assertFalse(code.contains(forbidden),name+": "+forbidden);
        }
    }
    private String bytecode(String name) throws Exception {
        try(var stream=getClass().getResourceAsStream("/com/clickinterval/solotest/"+name+".class")) { return new String(stream.readAllBytes(),StandardCharsets.ISO_8859_1); }
    }
}
