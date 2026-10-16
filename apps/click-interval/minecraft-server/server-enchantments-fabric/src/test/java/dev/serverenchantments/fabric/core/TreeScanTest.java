package dev.serverenchantments.fabric.core;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class TreeScanTest {
    private static final TreeScan.Point ROOT = new TreeScan.Point(0,64,0);
    private static Map<TreeScan.Point,TreeScan.Kind> tree(int extraLogs) {
        Map<TreeScan.Point,TreeScan.Kind> world = new HashMap<>();
        for(int i=1;i<=extraLogs;i++) world.put(ROOT.offset(0,i,0),TreeScan.Kind.LOG);
        world.put(ROOT.offset(1,2,0),TreeScan.Kind.NATURAL_LEAF);
        world.put(ROOT.offset(-1,2,0),TreeScan.Kind.NATURAL_LEAF);
        world.put(ROOT.offset(0,2,1),TreeScan.Kind.NATURAL_LEAF);
        world.put(ROOT.offset(0,2,-1),TreeScan.Kind.NATURAL_LEAF);
        return world;
    }
    private static void finish(TreeScan scan,Map<TreeScan.Point,TreeScan.Kind> world) {
        int turns=0;
        while(!scan.finished()) {
            assertTrue(scan.step(7,p -> world.getOrDefault(p,TreeScan.Kind.OTHER))<=7);
            assertTrue(++turns<1_000,"scan must terminate within a bounded amount of work");
        }
    }
    @Test void scansAcrossTicksAndPlansEveryConnectedLogWithoutTheAlreadyBrokenOrigin() {
        TreeScan scan=new TreeScan(ROOT,128,true);
        Map<TreeScan.Point,TreeScan.Kind> world=tree(6);
        world.put(ROOT.offset(1,5,1),TreeScan.Kind.LOG);
        assertEquals(1,scan.step(1,p->world.getOrDefault(p,TreeScan.Kind.OTHER)));
        assertFalse(scan.finished());
        assertTrue(scan.plan().isEmpty(),"no partial plan is exposed before validation");
        finish(scan,world);
        assertTrue(scan.valid());
        assertEquals(7,scan.plan().size());
        assertFalse(scan.plan().contains(ROOT));
        assertEquals(7,new HashSet<>(scan.plan()).size());
    }
    @Test void limitCountsTheManuallyBrokenLogAndRejectsTheWholeOversizedPlan() {
        TreeScan exact=new TreeScan(ROOT,5,true);
        finish(exact,tree(4));
        assertEquals(4,exact.plan().size());
        TreeScan tooLarge=new TreeScan(ROOT,5,true);
        finish(tooLarge,tree(5));
        assertFalse(tooLarge.valid());
        assertTrue(tooLarge.plan().isEmpty());
    }
    @Test void unloadedChunksMissingRootsAndArtificialLeaflessStructuresFailClosed() {
        Map<TreeScan.Point,TreeScan.Kind> unavailable=tree(6);
        unavailable.put(ROOT.offset(-1,-1,-1),TreeScan.Kind.UNAVAILABLE);
        TreeScan unloaded=new TreeScan(ROOT,128,true);
        finish(unloaded,unavailable);
        assertFalse(unloaded.valid());
        TreeScan floating=new TreeScan(ROOT,128,false);
        finish(floating,tree(6));
        assertFalse(floating.valid());
        Map<TreeScan.Point,TreeScan.Kind> building=tree(6);
        building.values().removeIf(kind->kind==TreeScan.Kind.NATURAL_LEAF);
        TreeScan structure=new TreeScan(ROOT,128,true);
        finish(structure,building);
        assertFalse(structure.valid());
    }
    @Test void aTrunkRootBelowTheClickedBlockStillQualifies() {
        Map<TreeScan.Point,TreeScan.Kind> world=tree(4);
        world.put(ROOT.offset(0,-1,0),TreeScan.Kind.ROOTED_LOG);
        TreeScan scan=new TreeScan(ROOT,128,false);
        finish(scan,world);
        assertTrue(scan.valid());
    }
}
