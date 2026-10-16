package com.clickinterval.market;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PickerPolicyTest {
    @Test void paginationHasNoEmptyTrailingPage() {
        assertEquals(1,PickerPolicy.pages(0)); assertEquals(1,PickerPolicy.pages(1));
        assertEquals(1,PickerPolicy.pages(36)); assertEquals(2,PickerPolicy.pages(37));
        assertEquals(2,PickerPolicy.pages(72)); assertEquals(3,PickerPolicy.pages(73));
    }
    @Test void everyItemMapsToExactlyOneVisibleSlot() {
        for(int size:new int[]{0,1,35,36,37,72,73,2000}) {
            int found=0;
            for(int page=0;page<PickerPolicy.pages(size);page++) for(int slot=9;slot<45;slot++) {
                int index=PickerPolicy.index(page,slot,size);
                if(index>=0) assertEquals(found++,index);
            }
            assertEquals(size,found);
        }
    }
    @Test void navigationAndInventorySlotsNeverSelectItems() {
        for(int slot:new int[]{Integer.MIN_VALUE,-999,-1,0,2,4,8,45,47,49,51,53,54,89,Integer.MAX_VALUE})
            assertEquals(-1,PickerPolicy.index(0,slot,2000));
        assertEquals(-1,PickerPolicy.index(-1,9,2000));
        assertEquals(-1,PickerPolicy.index(Integer.MAX_VALUE,9,2000));
    }
    @Test void emptyAndOutOfRangePagesClampSafely() {
        assertEquals(0,PickerPolicy.clampPage(999,0)); assertEquals(0,PickerPolicy.clampPage(-1,100));
        assertEquals(2,PickerPolicy.clampPage(999,100));
        assertEquals(-1,PickerPolicy.index(2,37,100));
    }
    @Test void adminOnlyAndPlaceholderItemsAreExcluded() {
        for(String id:new String[]{"air","barrier","command_block","debug_stick","test_block","spawner","vault","bedrock","pig_spawn_egg","infested_stone"})
            assertFalse(PickerPolicy.allowed("minecraft",id),id);
    }
    @Test void normalItemsAndUnknownModItemsRemainAvailable() {
        for(String id:new String[]{"diamond","stone","enchanted_book","potion","elytra","dragon_egg","nether_star","player_head"})
            assertTrue(PickerPolicy.allowed("minecraft",id),id);
        assertTrue(PickerPolicy.allowed("example","custom_item"));
        assertTrue(PickerPolicy.allowed("example","vault"));
    }
    @Test void largeCatalogMathDoesNotOverflow() {
        assertEquals(59_652_324,PickerPolicy.pages(Integer.MAX_VALUE));
        assertEquals(2_147_483_628,PickerPolicy.index(59_652_323,9,Integer.MAX_VALUE));
        assertEquals(-1,PickerPolicy.index(59_652_323,44,Integer.MAX_VALUE));
    }
}
