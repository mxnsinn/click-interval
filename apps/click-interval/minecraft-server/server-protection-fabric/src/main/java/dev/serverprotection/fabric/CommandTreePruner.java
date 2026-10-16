package dev.serverprotection.fabric;

import com.mojang.brigadier.builder.ArgumentBuilder;
import com.mojang.brigadier.tree.CommandNode;
import com.mojang.brigadier.tree.RootCommandNode;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Predicate;

/** Deep-copies a Brigadier tree while fail-closed pruning denied command roots and redirects. */
final class CommandTreePruner {
    private CommandTreePruner() { }

    static <S> RootCommandNode<S> copy(
            RootCommandNode<S> dispatcherRoot, S source, Predicate<String> rootAllowed) {
        return copy(dispatcherRoot, source, rootAllowed, ignored -> true);
    }

    static <S> RootCommandNode<S> copy(
            RootCommandNode<S> dispatcherRoot, S source, Predicate<String> rootAllowed,
            Predicate<String> pathAllowed) {
        RootCommandNode<S> filtered = new RootCommandNode<>();
        if (dispatcherRoot == null || source == null || rootAllowed == null || pathAllowed == null) return filtered;
        HashMap<CommandNode<S>, CommandNode<S>> mapped = new HashMap<>();
        mapped.put(dispatcherRoot, filtered);
        copyChildren(dispatcherRoot, filtered, source, mapped, rootAllowed, pathAllowed, "");
        return filtered;
    }

    private static <S> void copyChildren(
            CommandNode<S> sourceNode,
            CommandNode<S> targetNode,
            S source,
            Map<CommandNode<S>, CommandNode<S>> mapped,
            Predicate<String> rootAllowed,
            Predicate<String> pathAllowed,
            String parentPath) {
        for (CommandNode<S> child : sourceNode.getChildren()) {
            boolean roots = parentPath.isEmpty();
            String childPath = roots ? child.getName() : parentPath + " " + child.getName();
            if (!child.canUse(source) || (roots ? !rootAllowed.test(child.getName())
                    : !pathAllowed.test(childPath))) continue;
            ArgumentBuilder<S, ?> builder = child.createBuilder();
            if (builder.getRedirect() != null) {
                CommandNode<S> redirect = mapped.get(builder.getRedirect());
                // Do not include a redirect if its destination was pruned or has not itself passed
                // the visibility check. Otherwise packet enumeration would pull the hidden root in.
                if (redirect == null) continue;
                builder.redirect(redirect);
            }
            CommandNode<S> copy = builder.build();
            mapped.put(child, copy);
            targetNode.addChild(copy);
            if (!child.getChildren().isEmpty()) {
                copyChildren(child, copy, source, mapped, rootAllowed, pathAllowed, childPath);
            }
        }
    }
}
