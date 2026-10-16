package dev.serverprotection.fabric;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class ItemSlowPolicyTest {
    @Test void sprintingSpearsAndNonSlowingItemsAreNotNoSlowEvidence(){
        assertFalse(ItemSlowPolicy.check(true,true,0.2F));
        assertFalse(ItemSlowPolicy.check(true,true,1F));
        assertFalse(ItemSlowPolicy.check(true,false,1F));
        assertFalse(ItemSlowPolicy.check(true,false,0.5F));
    }
    @Test void ordinarySlowItemsRemainCheckedOnlyWhileUsed(){
        assertTrue(ItemSlowPolicy.check(true,false,0.2F));
        assertFalse(ItemSlowPolicy.check(false,false,0.2F));
        assertFalse(ItemSlowPolicy.check(true,false,Float.NaN));
    }
}
