package com.clickinterval.market;

import java.util.Set;

/** Pure picker boundaries; no registry/bootstrap needed for unit tests. */
final class PickerPolicy {
    static final int FIRST_SLOT=9, PAGE_SIZE=36;
    private static final Set<String> ADMIN_ITEMS=Set.of(
            "air","barrier","light","structure_void","structure_block","jigsaw",
            "command_block","chain_command_block","repeating_command_block","command_block_minecart",
            "debug_stick","knowledge_book","test_block","test_instance_block",
            "spawner","trial_spawner","vault","bedrock","end_portal_frame",
            "reinforced_deepslate","budding_amethyst","petrified_oak_slab","farmland","dirt_path",
            "suspicious_sand","suspicious_gravel","frogspawn","chorus_plant");
    private PickerPolicy() {}
    static boolean allowed(String namespace,String path) {
        // Unknown mod items stay visible: do not guess which modded items are obtainable.
        return !namespace.equals("minecraft") || !ADMIN_ITEMS.contains(path)
                && !path.endsWith("_spawn_egg") && !path.startsWith("infested_");
    }
    static int pages(int size) { return size<=0?1:1+(size-1)/PAGE_SIZE; }
    static int clampPage(int page,int size) { return Math.clamp(page,0,pages(size)-1); }
    static int index(int page,int slot,int size) {
        if(page<0 || slot<FIRST_SLOT || slot>=FIRST_SLOT+PAGE_SIZE) return -1;
        long index=(long)page*PAGE_SIZE+slot-FIRST_SLOT;
        return index>=size?-1:(int)index;
    }
}
