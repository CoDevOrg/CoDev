import { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { WebSocketConnectionSource } from "@theia/core/lib/browser/messaging/ws-connection-source";
import { CommandContribution, MenuContribution } from "@theia/core/lib/common";
import { ContainerModule } from "@theia/core/shared/inversify";
import { CoDevConnectionSource } from "./codev-connection-source";
import { CoDevExtensionContribution } from "./theia-extension-contribution";

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  rebind(WebSocketConnectionSource)
    .to(CoDevConnectionSource)
    .inSingletonScope();
  bind(CoDevExtensionContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(CoDevExtensionContribution);
  bind(CommandContribution).toService(CoDevExtensionContribution);
  bind(MenuContribution).toService(CoDevExtensionContribution);
});
