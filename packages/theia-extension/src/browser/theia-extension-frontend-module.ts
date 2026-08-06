import { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { CommandContribution, MenuContribution } from "@theia/core/lib/common";
import { ContainerModule } from "@theia/core/shared/inversify";
import { CoDevExtensionContribution } from "./theia-extension-contribution";

export default new ContainerModule((bind) => {
  bind(CoDevExtensionContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(CoDevExtensionContribution);
  bind(CommandContribution).toService(CoDevExtensionContribution);
  bind(MenuContribution).toService(CoDevExtensionContribution);
});
