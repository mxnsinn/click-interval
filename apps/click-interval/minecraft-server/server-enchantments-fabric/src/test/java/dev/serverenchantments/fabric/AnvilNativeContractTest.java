package dev.serverenchantments.fabric;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.*;
import java.io.InputStream;
import static org.junit.jupiter.api.Assertions.*;

final class AnvilNativeContractTest {
    private ClassNode read(String name) throws Exception {
        try(InputStream in=getClass().getClassLoader().getResourceAsStream(name+".class")) {
            assertNotNull(in,name);
            ClassNode node=new ClassNode();new ClassReader(in).accept(node,0);return node;
        }
    }
    @Test void nativeCostSetterAndAllThree40SentinelsRemainTheAudited26_2Shape() throws Exception {
        var nativeClass=read("net/minecraft/world/inventory/AnvilMenu");
        var create=nativeClass.methods.stream().filter(m->m.name.equals("createResult") && m.desc.equals("()V")).findFirst().orElseThrow();
        int setters=0,forties=0;
        for(var instruction:create.instructions) {
            if(instruction instanceof MethodInsnNode call && call.owner.equals("net/minecraft/world/inventory/DataSlot") && call.name.equals("set") && call.desc.equals("(I)V"))setters++;
            if(instruction instanceof IntInsnNode integer && integer.operand==40)forties++;
        }
        assertEquals(7,setters,"review injection if vanilla cost-setting branches change");
        assertEquals(3,forties,"stacked-input sentinel, rename threshold and output threshold");
    }
    @Test void nativePickupChecksExperienceAndNativeTakeDeductsIt() throws Exception {
        var nativeClass=read("net/minecraft/world/inventory/AnvilMenu");
        var pickup=nativeClass.methods.stream().filter(m->m.name.equals("mayPickup")).findFirst().orElseThrow();
        var take=nativeClass.methods.stream().filter(m->m.name.equals("onTake")).findFirst().orElseThrow();
        boolean checksExperience=false,paysExperience=false;
        for(var i:pickup.instructions)if(i instanceof FieldInsnNode field && field.name.equals("experienceLevel") && field.getOpcode()==Opcodes.GETFIELD)checksExperience=true;
        for(var i:take.instructions)if(i instanceof MethodInsnNode call && call.name.equals("giveExperienceLevels") && call.desc.equals("(I)V"))paysExperience=true;
        assertTrue(checksExperience);assertTrue(paysExperience);
    }
    @Test void mixinGatesOnRealServerPlayerAndDoesNotOverwriteNativePermissionOrTakePaths() throws Exception {
        var mixin=read("dev/serverenchantments/fabric/mixin/AnvilMenuMixin");
        boolean serverGuard=false,policyCall=false;
        for(var method:mixin.methods) {
            assertNotEquals("mayPickup",method.name);assertNotEquals("onTake",method.name);
            for(var i:method.instructions) {
                if(i instanceof TypeInsnNode type && type.getOpcode()==Opcodes.INSTANCEOF && type.desc.equals("net/minecraft/server/level/ServerPlayer"))serverGuard=true;
                if(i instanceof MethodInsnNode call && call.owner.endsWith("AnvilCostPolicy") && call.name.equals("cappedCost")) { assertTrue(serverGuard,"server guard must precede cap");policyCall=true; }
                if(i instanceof FieldInsnNode field)assertNotEquals(Opcodes.PUTFIELD,field.getOpcode(),"no ability/permission mutations");
            }
        }
        assertTrue(serverGuard);assertTrue(policyCall);
    }
}
