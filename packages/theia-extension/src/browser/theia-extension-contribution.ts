import { FrontendApplicationContribution } from "@theia/core/lib/browser";
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
} from "@theia/core/lib/common";
import { injectable } from "@theia/core/shared/inversify";

export const FocusCoDevAgentsCommand: Command = {
  id: "codev.agents.focus",
  label: "CoDev: Focus Agents",
};

@injectable()
export class CoDevExtensionContribution
  implements
    FrontendApplicationContribution,
    CommandContribution,
    MenuContribution
{
  onStart(): void {
    this.notifyShell("ready");
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(FocusCoDevAgentsCommand, {
      execute: () => this.notifyShell("focus-agents"),
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(["view"], {
      commandId: FocusCoDevAgentsCommand.id,
      label: "CoDev Agents",
      order: "0_codev_agents",
    });
  }

  private notifyShell(type: "ready" | "focus-agents"): void {
    if (window.parent === window) {
      return;
    }

    window.parent.postMessage(
      {
        source: "codev-theia",
        type,
      },
      window.location.origin,
    );
  }
}
