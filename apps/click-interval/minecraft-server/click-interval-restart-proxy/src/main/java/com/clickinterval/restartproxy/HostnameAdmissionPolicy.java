package com.clickinterval.restartproxy;

import java.net.InetSocketAddress;
import java.util.Locale;

/** A user-facing address migration rule, not authentication or IP concealment. */
final class HostnameAdmissionPolicy {
  private HostnameAdmissionPolicy() {}

  static String normalizeRequiredHostname(String hostname) {
    String normalized = normalize(hostname == null ? "" : hostname.trim());
    if (!normalized.isEmpty()
        && (normalized.length() > 253
            || !normalized.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+"))) {
      throw new IllegalArgumentException("required-hostname must be blank or a plain DNS hostname");
    }
    return normalized;
  }

  static boolean allows(String requiredHostname, String presentedHostname, InetSocketAddress remote) {
    if (requiredHostname.isEmpty()) {
      return true;
    }
    String presented = normalize(presentedHostname);
    if (requiredHostname.equals(presented)) {
      return true;
    }
    // A public peer cannot bypass the rule by putting localhost in its handshake.
    // Local owner access remains available even when the router lacks NAT loopback.
    return remote != null && remote.getAddress() != null && remote.getAddress().isLoopbackAddress()
        && (presented.equals("localhost") || presented.equals("127.0.0.1")
            || presented.equals("::1") || presented.equals("[::1]"));
  }

  private static String normalize(String hostname) {
    if (hostname == null) {
      return "";
    }
    String normalized = hostname.toLowerCase(Locale.ROOT);
    return normalized.endsWith(".") ? normalized.substring(0, normalized.length() - 1) : normalized;
  }
}
