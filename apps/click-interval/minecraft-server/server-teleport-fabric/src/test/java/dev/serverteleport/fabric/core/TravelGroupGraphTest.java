package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TravelGroupGraphTest {
    private static final TravelGroupGraph.Adapter<Node> ADAPTER = new TravelGroupGraph.Adapter<>() {
        @Override
        public UUID id(Node entity) {
            return entity == null ? null : entity.id;
        }

        @Override
        public boolean unavailable(Node entity) {
            return entity == null || entity.removed;
        }

        @Override
        public boolean player(Node entity) {
            return entity.player;
        }

        @Override
        public Node rootVehicle(Node entity) {
            Node cursor = entity;
            HashSet<UUID> visited = new HashSet<>();
            while (cursor != null && cursor.vehicle != null && visited.add(cursor.id)) {
                cursor = cursor.vehicle;
            }
            return cursor;
        }

        @Override
        public List<Node> selfAndPassengers(Node root) {
            ArrayList<Node> result = new ArrayList<>();
            collect(root, result, new HashSet<>());
            return List.copyOf(result);
        }

        @Override
        public List<Node> eligibleEntitiesLeashedTo(Node holder) {
            return List.copyOf(holder.leashed);
        }
    };

    @Test
    void playerRidingBoatCarriesVillagerInTheSameVehicleTree() {
        Node player = player("traveler");
        Node boat = entity("boat");
        Node villager = entity("villager");
        mount(boat, player, villager);

        TravelGroupGraph<Node> graph = new TravelGroupGraph<>(32, ADAPTER);

        assertEquals(TravelGroupGraph.Result.ADDED, graph.addRoot(ADAPTER.rootVehicle(player), player));
        assertEquals(List.of("boat"), names(graph.roots()));
        assertEquals(Set.of("boat", "traveler", "villager"), Set.copyOf(names(graph.members())));
    }

    @Test
    void playerLeadingBoatCarriesBoatAndBothVillagerPassengers() {
        Node player = player("traveler");
        Node boat = entity("boat");
        Node firstVillager = entity("villager-one");
        Node secondVillager = entity("villager-two");
        mount(boat, firstVillager, secondVillager);
        lead(player, boat);

        TravelGroupGraph<Node> graph = new TravelGroupGraph<>(32, ADAPTER);

        assertEquals(TravelGroupGraph.Result.ADDED, graph.addRoot(player, player));
        assertEquals(TravelGroupGraph.Result.ADDED, graph.expandLeashClosure(player));
        assertEquals(List.of("traveler", "boat"), names(graph.roots()));
        assertEquals(
                Set.of("traveler", "boat", "villager-one", "villager-two"),
                Set.copyOf(names(graph.members())));
    }

    @Test
    void nestedPassengersAndTransitiveLeashesAreDeduplicatedAndCyclesTerminate() {
        Node player = player("traveler");
        Node boat = entity("boat");
        Node villager = entity("villager");
        Node chicken = entity("chicken");
        Node camel = entity("camel");
        mount(boat, villager);
        mount(villager, chicken);
        lead(player, boat);
        lead(boat, camel);
        lead(camel, boat);

        TravelGroupGraph<Node> graph = new TravelGroupGraph<>(32, ADAPTER);
        assertEquals(TravelGroupGraph.Result.ADDED, graph.addRoot(player, player));
        assertEquals(TravelGroupGraph.Result.ADDED, graph.expandLeashClosure(player));

        assertEquals(5, graph.size());
        assertEquals(
                Set.of("traveler", "boat", "villager", "chicken", "camel"),
                Set.copyOf(names(graph.members())));
    }

    @Test
    void anotherPlayerAnywhereInThePassengerTreeRejectsTheRoot() {
        Node player = player("traveler");
        Node otherPlayer = player("other-player");
        Node boat = entity("boat");
        mount(boat, player, otherPlayer);

        TravelGroupGraph<Node> graph = new TravelGroupGraph<>(32, ADAPTER);

        assertEquals(
                TravelGroupGraph.Result.CONTAINS_OTHER_PLAYER,
                graph.addRoot(ADAPTER.rootVehicle(player), player));
        assertTrue(graph.roots().isEmpty());
        assertTrue(graph.members().isEmpty());
    }

    @Test
    void capacityFailureDoesNotPartiallyAddTheVehicleTree() {
        Node player = player("traveler");
        Node boat = entity("boat");
        Node firstVillager = entity("villager-one");
        Node secondVillager = entity("villager-two");
        mount(boat, firstVillager, secondVillager);
        lead(player, boat);

        TravelGroupGraph<Node> graph = new TravelGroupGraph<>(3, ADAPTER);
        assertEquals(TravelGroupGraph.Result.ADDED, graph.addRoot(player, player));
        assertEquals(TravelGroupGraph.Result.TOO_LARGE, graph.expandLeashClosure(player));

        assertEquals(List.of("traveler"), names(graph.roots()));
        assertEquals(List.of("traveler"), names(graph.members()));
    }

    private static void collect(Node node, List<Node> output, Set<UUID> visited) {
        if (node == null || !visited.add(node.id)) return;
        output.add(node);
        for (Node passenger : node.passengers) collect(passenger, output, visited);
    }

    private static void mount(Node vehicle, Node... passengers) {
        for (Node passenger : passengers) {
            passenger.vehicle = vehicle;
            vehicle.passengers.add(passenger);
        }
    }

    private static void lead(Node holder, Node attached) {
        holder.leashed.add(attached);
    }

    private static Node player(String name) {
        return new Node(name, true);
    }

    private static Node entity(String name) {
        return new Node(name, false);
    }

    private static List<String> names(List<Node> nodes) {
        return nodes.stream().map(node -> node.name).toList();
    }

    private static final class Node {
        private final String name;
        private final UUID id;
        private final boolean player;
        private final List<Node> passengers = new ArrayList<>();
        private final List<Node> leashed = new ArrayList<>();
        private Node vehicle;
        private boolean removed;

        private Node(String name, boolean player) {
            this.name = name;
            this.player = player;
            this.id = UUID.nameUUIDFromBytes(name.getBytes(StandardCharsets.UTF_8));
        }
    }
}
