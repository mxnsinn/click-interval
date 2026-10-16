package com.clickinterval.villagertrades.client;

import com.clickinterval.villagertrades.network.CycleStatus;
import com.clickinterval.villagertrades.network.CycleRequest;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;

public final class VillagerTradesClient implements ClientModInitializer {
    @Override public void onInitializeClient() {
        // Standalone optional client artifact does not include/run the server initializer.
        PayloadTypeRegistry.serverboundPlay().register(CycleRequest.TYPE, CycleRequest.CODEC);
        PayloadTypeRegistry.clientboundPlay().register(CycleStatus.TYPE, CycleStatus.CODEC);
        ClientPlayNetworking.registerGlobalReceiver(CycleStatus.TYPE, (payload, context) -> {
            if (context.client().gui.screen() instanceof CycleScreen screen) screen.clickInterval$acceptCycleStatus(payload);
        });
        org.slf4j.LoggerFactory.getLogger("clickinterval_trade_button").info(
                "Click Interval Trade Button ready: client payload codecs and receiver registered; native merchant screen retained.");
    }
}
