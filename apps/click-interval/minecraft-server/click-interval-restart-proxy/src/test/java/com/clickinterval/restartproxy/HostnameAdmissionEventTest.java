package com.clickinterval.restartproxy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.connection.PreLoginEvent;
import com.velocitypowered.api.proxy.InboundConnection;
import java.lang.reflect.Proxy;
import java.net.InetSocketAddress;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.junit.jupiter.api.Test;

final class HostnameAdmissionEventTest {
  @Test
  void oldAddressReceivesExactMigrationMessageBeforeLogin() throws Exception {
    PreLoginEvent event = event("86.97.163.169");
    plugin("mxnsinn-smp.net").onPreLogin(event);
    assertFalse(event.getResult().isAllowed());
    assertEquals(Component.text("Server address changed. Please join mxnsinn-smp.net", NamedTextColor.YELLOW),
        event.getResult().getReasonComponent().orElseThrow());
  }

  @Test
  void domainLoginKeepsItsExistingAuthenticationResult() throws Exception {
    PreLoginEvent event = event("MXNSINN-SMP.NET.");
    PreLoginEvent.PreLoginComponentResult result = PreLoginEvent.PreLoginComponentResult.forceOnlineMode();
    event.setResult(result);
    plugin("mxnsinn-smp.net").onPreLogin(event);
    assertSame(result, event.getResult());
  }

  @Test
  void doesNotReplaceAnotherPluginsRejectionOrEnableDisabledPolicy() throws Exception {
    PreLoginEvent event = event("86.97.163.169");
    PreLoginEvent.PreLoginComponentResult result = PreLoginEvent.PreLoginComponentResult.denied(Component.text("Banned"));
    event.setResult(result);
    plugin("mxnsinn-smp.net").onPreLogin(event);
    assertSame(result, event.getResult());
    PreLoginEvent disabled = event("86.97.163.169");
    plugin("").onPreLogin(disabled);
    assertTrue(disabled.getResult().isAllowed());
  }

  private static ClickIntervalRestartProxy plugin(String domain) throws Exception {
    ClickIntervalRestartProxy plugin = new ClickIntervalRestartProxy(null, null, Path.of("unused-test-path"));
    java.lang.reflect.Field config = ClickIntervalRestartProxy.class.getDeclaredField("config");
    config.setAccessible(true);
    config.set(plugin, new RestartProxyConfig("main", "maintenance", "Updating", 15, 30, domain));
    return plugin;
  }

  private static PreLoginEvent event(String hostname) {
    InboundConnection connection = (InboundConnection) Proxy.newProxyInstance(
        InboundConnection.class.getClassLoader(), new Class<?>[] {InboundConnection.class},
        (proxy, method, args) -> switch (method.getName()) {
          case "getVirtualHost" -> Optional.of(InetSocketAddress.createUnresolved(hostname, 25565));
          case "getRemoteAddress" -> new InetSocketAddress("192.0.2.4", 48000);
          default -> throw new UnsupportedOperationException(method.getName());
        });
    return new PreLoginEvent(connection, "AddressTest", UUID.randomUUID());
  }
}
