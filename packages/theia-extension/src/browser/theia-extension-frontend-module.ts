import { ContainerModule } from "inversify";
import { CommandContribution, MenuContribution } from "@theia/core/lib/common";
import { WidgetFactory, bindViewContribution } from "@theia/core/lib/browser";
import { CoDevAgentWidget } from "./codev-agent-widget";
import { CoDevExtensionContribution } from "./theia-extension-contribution";

export default new ContainerModule((bind) => {
  bindViewContribution(bind, CoDevExtensionContribution);
  bind(CommandContribution).toService(CoDevExtensionContribution);
  bind(MenuContribution).toService(CoDevExtensionContribution);

  bind(CoDevAgentWidget).toSelf();
  bind(WidgetFactory).toDynamicValue((ctx) => ({
    id: CoDevAgentWidget.ID,
    createWidget: () => ctx.container.get<CoDevAgentWidget>(CoDevAgentWidget),
  }));
});
