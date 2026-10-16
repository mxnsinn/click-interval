package dev.serverprotection.client;

import com.clickinterval.chat.protocol.MentionContextPayload;
import java.util.List;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;

/** Local recipient-owned aliases; cleared when leaving a server, with no client draft transmission. */
public final class MentionContextClient {
    private static List<String> ownTeamNames = List.of();
    private MentionContextClient() { }

    static void register() {
        MentionContextPayload.register();
        ClientPlayNetworking.registerGlobalReceiver(MentionContextPayload.TYPE, (payload, context) ->
                context.client().execute(() -> ownTeamNames = payload.names()));
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> ownTeamNames = List.of());
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> ownTeamNames = List.of());
    }

    public static List<String> ownTeamNames() { return ownTeamNames; }
}
