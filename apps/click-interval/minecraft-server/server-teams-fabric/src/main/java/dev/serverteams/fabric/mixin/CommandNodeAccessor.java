package dev.serverteams.fabric.mixin;
import com.mojang.brigadier.tree.CommandNode;
import java.util.function.Predicate;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.gen.Accessor;
@Mixin(value=CommandNode.class,remap=false)
public interface CommandNodeAccessor<S> {
    @Mutable @Accessor("requirement") void serverteams$requirement(Predicate<S> requirement);
}
