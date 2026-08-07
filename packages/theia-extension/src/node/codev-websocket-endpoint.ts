import { WebsocketEndpoint } from "@theia/core/lib/node/messaging/websocket-endpoint";
import { injectable } from "@theia/core/shared/inversify";

/**
 * Keep Engine.IO long-poll heartbeats below the 30-second AWS HTTP API limit.
 * Otherwise the proxy closes the pending poll just before Theia sends its ping.
 */
@injectable()
export class CoDevWebsocketEndpoint extends WebsocketEndpoint {
  protected override checkAliveTimeout = 10_000;
}
