package dev.serverteams.fabric;
import java.util.UUID;
import net.minecraft.commands.functions.StringTemplate;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class DialogInputKeyTest {
    @Test void trustUuidKeysPassNativeDialogVariableValidation(){
        UUID id=UUID.fromString("fc30ed23-678f-34a1-af21-154d69c8a17c");
        assertFalse(StringTemplate.isValidVariableName("trust_"+id));
        assertEquals("trust_fc30ed23678f34a1af21154d69c8a17c",TeamDialogs.trustKey(id));
        assertTrue(StringTemplate.isValidVariableName(TeamDialogs.trustKey(id)));
        assertTrue(TeamDialogs.trustKey(id).length()<=48);
    }
}
