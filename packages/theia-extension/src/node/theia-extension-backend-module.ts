import { WebsocketEndpoint } from "@theia/core/lib/node/messaging/websocket-endpoint";
import { ContainerModule } from "@theia/core/shared/inversify";

import { CoDevWebsocketEndpoint } from "./codev-websocket-endpoint";

export default new ContainerModule((_bind, _unbind, _isBound, rebind) => {
  rebind(WebsocketEndpoint).to(CoDevWebsocketEndpoint).inSingletonScope();
});
