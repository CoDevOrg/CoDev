import { injectable } from "inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import {
  Command,
  CommandRegistry,
  MenuModelRegistry,
} from "@theia/core/lib/common";
import { CoDevAgentWidget } from "./codev-agent-widget";

export const CoDevAgentCommand: Command = {
  id: "codev.agent.open",
  label: "CoDev: Open AI Agent Panel",
};

@injectable()
export class CoDevExtensionContribution extends AbstractViewContribution<CoDevAgentWidget> {
  constructor() {
    super({
      widgetId: CoDevAgentWidget.ID,
      widgetName: CoDevAgentWidget.LABEL,
      defaultWidgetOptions: {
        area: "left",
        rank: 100,
      },
    });
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(CoDevAgentCommand, {
      execute: () => this.openView({ activate: true }),
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(["view"], {
      commandId: CoDevAgentCommand.id,
      label: CoDevAgentWidget.LABEL,
    });
  }
}
