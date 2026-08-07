import { ReactWidget, codicon } from "@theia/core/lib/browser";
import * as React from "@theia/core/shared/react";
import { injectable } from "@theia/core/shared/inversify";

import {
  workspaceAgentsPath,
  workspaceIdFromSearch,
} from "./codev-workspace-context";

export const CODEV_AGENT_WIDGET_ID = "codev.agents";
export const CODEV_AGENT_WIDGET_LABEL = "Agents";

@injectable()
export class CodevAgentWidget extends ReactWidget {
  constructor() {
    super();
    this.id = CODEV_AGENT_WIDGET_ID;
    this.title.label = CODEV_AGENT_WIDGET_LABEL;
    this.title.caption = "CoDev agent workspace";
    this.title.iconClass = codicon("comment-discussion");
    this.title.closable = true;
    this.addClass("codev-agent-widget");
    this.node.style.minWidth = "360px";
    this.update();
  }

  protected render(): React.ReactNode {
    const workspaceId = workspaceIdFromSearch(window.location.search);
    if (!workspaceId) {
      return React.createElement(
        "div",
        { style: { padding: "16px" } },
        "Agents are unavailable because this workspace link is invalid.",
      );
    }

    return React.createElement("iframe", {
      title: "CoDev agents",
      src: workspaceAgentsPath(workspaceId),
      allow: "clipboard-read; clipboard-write",
      style: {
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
      },
    });
  }
}
