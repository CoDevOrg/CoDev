import {
  AbstractViewContribution,
  type FrontendApplication,
  type FrontendApplicationContribution,
} from "@theia/core/lib/browser";
import { injectable } from "@theia/core/shared/inversify";

import {
  CODEV_AGENT_WIDGET_ID,
  CODEV_AGENT_WIDGET_LABEL,
  CodevAgentWidget,
} from "./codev-agent-widget";

export const ToggleCoDevAgentsCommand = {
  id: "codev.agents.focus",
};

@injectable()
export class CoDevExtensionContribution
  extends AbstractViewContribution<CodevAgentWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: CODEV_AGENT_WIDGET_ID,
      widgetName: CODEV_AGENT_WIDGET_LABEL,
      defaultWidgetOptions: {
        area: "right",
        rank: 100,
      },
      toggleCommandId: ToggleCoDevAgentsCommand.id,
      toggleKeybinding: "ctrlcmd+shift+a",
    });
  }

  async onDidInitializeLayout(
    _application: FrontendApplication,
  ): Promise<void> {
    if (!this.tryGetWidget()) {
      await this.openView({ activate: false, reveal: true });
    }
  }
}
