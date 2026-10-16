package com.clickinterval.restartproxy;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Objects;
import java.util.Properties;

record RestartProxyConfig(
    String mainServer,
    String maintenanceServer,
    String defaultMessage,
    int drainTimeoutSeconds,
    int restoreTimeoutSeconds,
    String requiredHostname) {

  private static final int MAX_RESTORE_TIMEOUT_SECONDS = 120;

  RestartProxyConfig {
    Objects.requireNonNull(mainServer, "mainServer");
    Objects.requireNonNull(maintenanceServer, "maintenanceServer");
    Objects.requireNonNull(defaultMessage, "defaultMessage");
    requiredHostname = HostnameAdmissionPolicy.normalizeRequiredHostname(requiredHostname);
    if (mainServer.isBlank()) {
      throw new IllegalArgumentException("main-server cannot be blank");
    }
    if (defaultMessage.isBlank()) {
      throw new IllegalArgumentException("default-message cannot be blank");
    }
    if (maintenanceServer.isBlank()) {
      throw new IllegalArgumentException("maintenance-server cannot be blank");
    }
    if (mainServer.equalsIgnoreCase(maintenanceServer)) {
      throw new IllegalArgumentException("main-server and maintenance-server must be different");
    }
    if (restoreTimeoutSeconds < 5 || restoreTimeoutSeconds > MAX_RESTORE_TIMEOUT_SECONDS) {
      throw new IllegalArgumentException("restore-timeout-seconds must be between 5 and 120");
    }
    if (drainTimeoutSeconds < 5 || drainTimeoutSeconds > MAX_RESTORE_TIMEOUT_SECONDS) {
      throw new IllegalArgumentException("drain-timeout-seconds must be between 5 and 120");
    }
  }

  static RestartProxyConfig load(Path dataDirectory) throws IOException {
    Files.createDirectories(dataDirectory);
    Path configPath = dataDirectory.resolve("config.properties");
    if (Files.notExists(configPath)) {
      try (InputStream input = RestartProxyConfig.class.getResourceAsStream("/default-config.properties")) {
        if (input == null) {
          throw new IOException("Missing bundled default-config.properties");
        }
        Files.copy(input, configPath, StandardCopyOption.COPY_ATTRIBUTES);
      }
    }

    Properties properties = new Properties();
    try (InputStream input = Files.newInputStream(configPath)) {
      properties.load(input);
    }

    return fromProperties(properties);
  }

  static RestartProxyConfig fromProperties(Properties properties) {
    Objects.requireNonNull(properties, "properties");
    return new RestartProxyConfig(
        require(properties, "main-server"),
        require(properties, "maintenance-server"),
        require(properties, "default-message"),
        parseInteger(properties, "drain-timeout-seconds"),
        parseInteger(properties, "restore-timeout-seconds"),
        properties.getProperty("required-hostname", ""));
  }

  private static String require(Properties properties, String key) {
    String value = properties.getProperty(key);
    if (value == null || value.trim().isEmpty()) {
      throw new IllegalArgumentException("Missing configuration property: " + key);
    }
    return value.trim();
  }

  private static int parseInteger(Properties properties, String key) {
    String value = require(properties, key);
    try {
      return Integer.parseInt(value);
    } catch (NumberFormatException exception) {
      throw new IllegalArgumentException(key + " must be an integer", exception);
    }
  }
}
