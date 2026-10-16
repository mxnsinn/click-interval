package com.clickinterval.restartproxy;

import com.velocitypowered.api.proxy.ConnectionRequestBuilder;
import java.util.Objects;

final class RestoreConnectionPolicy {
  enum Action {
    WAIT_FOR_CONNECTED_EVENT,
    COMPLETE_ALREADY_CONNECTED,
    DISCONNECT_BACKEND_REJECTION,
    WAIT_FOR_TIMEOUT
  }

  private RestoreConnectionPolicy() {}

  static Action classify(ConnectionRequestBuilder.Status status) {
    Objects.requireNonNull(status, "status");
    return switch (status) {
      case SUCCESS -> Action.WAIT_FOR_CONNECTED_EVENT;
      case ALREADY_CONNECTED -> Action.COMPLETE_ALREADY_CONNECTED;
      case SERVER_DISCONNECTED -> Action.DISCONNECT_BACKEND_REJECTION;
      case CONNECTION_IN_PROGRESS, CONNECTION_CANCELLED -> Action.WAIT_FOR_TIMEOUT;
    };
  }
}
