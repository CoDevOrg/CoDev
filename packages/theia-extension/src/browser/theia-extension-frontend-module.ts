import {
  bindViewContribution,
  FrontendApplicationContribution,
  WidgetFactory,
} from "@theia/core/lib/browser";
import { ContainerModule } from "@theia/core/shared/inversify";
import { CODEV_AGENT_WIDGET_ID, CodevAgentWidget } from "./codev-agent-widget";
import { CoDevExtensionContribution } from "./theia-extension-contribution";

export default new ContainerModule((bind) => {
  bind(CodevAgentWidget).toSelf();
  bind(WidgetFactory).toDynamicValue((context) => ({
    id: CODEV_AGENT_WIDGET_ID,
    createWidget: () => context.container.get(CodevAgentWidget),
  }));
  bindViewContribution(bind, CoDevExtensionContribution);
  bind(FrontendApplicationContribution).toService(CoDevExtensionContribution);
});
