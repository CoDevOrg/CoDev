import { WebSocketConnectionSource } from "@theia/core/lib/browser/messaging/ws-connection-source";
import { ContainerModule } from "@theia/core/shared/inversify";

import { CoDevConnectionSource } from "./codev-connection-source";

export default new ContainerModule((_bind, _unbind, _isBound, rebind) => {
  rebind(WebSocketConnectionSource)
    .to(CoDevConnectionSource)
    .inSingletonScope();
});
