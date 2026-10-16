package dev.serverenchantments.fabric.core;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
final class WideStripTest {
    @Test void levelOneHasExactlyTwoExtrasOnTheSameYWithNoDepthOrVerticalMining() {
        TreeScan.Point center=new TreeScan.Point(-8,15,9);
        for(boolean x:List.of(true,false)) {
            var points=WideStrip.extras(center,x);
            assertEquals(2,points.size());
            assertEquals(2,new HashSet<>(points).size());
            assertFalse(points.contains(center));
            assertTrue(points.stream().allMatch(p->p.y()==15 && (x?p.z()==9:p.x()==-8)));
            assertEquals(Set.of(-1,1),new HashSet<>(points.stream().map(p->x?p.x()+8:p.z()-9).toList()));
        }
    }
    @Test void levelOneFaceAwareOverloadPreservesHorizontalChoiceForEveryNormal() {
        TreeScan.Point center=new TreeScan.Point(127,-63,-129);
        for(var face:WideStrip.Axis.values()) for(boolean x:List.of(true,false))
            assertEquals(WideStrip.extras(center,x),WideStrip.extras(center,face,x,1));
    }
    @Test void levelTwoHasEveryCellExceptCenterInTheExactFacePlaneForAllAxes() {
        TreeScan.Point center=new TreeScan.Point(-8,15,9);
        for(var face:WideStrip.Axis.values()) for(boolean x:List.of(true,false)) {
            Set<TreeScan.Point> expected=new HashSet<>();
            for(int a=-1;a<=1;a++) for(int b=-1;b<=1;b++) {
                if(a==0 && b==0) continue;
                expected.add(switch(face) {
                    case X -> center.offset(0,a,b);
                    case Y -> center.offset(a,0,b);
                    case Z -> center.offset(a,b,0);
                });
            }
            var actual=WideStrip.extras(center,face,x,2);
            assertEquals(8,actual.size());
            assertEquals(expected,new HashSet<>(actual),face+" face plane, alongX="+x);
            assertFalse(actual.contains(center));
        }
    }
    @Test void strongerOrMalformedLevelsNeverExpandPastTheNineBlockCap() {
        TreeScan.Point center=new TreeScan.Point(29_999_980,200,-29_999_980);
        for(var face:WideStrip.Axis.values()) {
            assertEquals(WideStrip.extras(center,face,true,2),WideStrip.extras(center,face,true,Integer.MAX_VALUE));
            assertEquals(WideStrip.extras(center,true),WideStrip.extras(center,face,true,0));
            assertEquals(WideStrip.extras(center,false),WideStrip.extras(center,face,false,-10));
        }
    }
}
