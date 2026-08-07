import { WebSocketConnectionSource } from "@theia/core/lib/browser/messaging/ws-connection-source";
import { injectable, postConstruct } from "@theia/core/shared/inversify";

import {
  workspaceIdFromSearch,
  workspaceStartupError,
} from "./codev-workspace-context";

@injectable()
export class CoDevConnectionSource extends WebSocketConnectionSource {
  private bootstrapComplete = false;
  private bootstrapPending = false;

  @postConstruct()
  override openSocket(): void {
    const workspaceId = workspaceIdFromSearch(window.location.search);
    if (!workspaceId || this.bootstrapComplete) {
      super.openSocket();
      return;
    }
    if (this.bootstrapPending) {
      return;
    }

    this.bootstrapPending = true;
    this.showStartupState(
      "Starting your workspace",
      "A workspace that has been idle may take a few minutes to wake up.",
    );
    void this.bootstrap(workspaceId);
  }

  protected override createSocketIoPath(url: string): string | undefined {
    const workspaceId = workspaceIdFromSearch(window.location.search);
    if (!workspaceId) {
      return super.createSocketIoPath(url);
    }
    return `/api/workspaces/${workspaceId}/theia/socket.io`;
  }

  private async bootstrap(workspaceId: string): Promise<void> {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/theia/bootstrap`,
        {
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const startupError = await workspaceStartupError(response);
      if (startupError) throw new Error(startupError);

      this.bootstrapComplete = true;
      this.showStartupState(
        "Opening the IDE",
        "The workspace is ready. Connecting the editor now…",
      );
      super.openSocket();
    } catch (error) {
      this.showStartupFailure(
        error instanceof Error ? error.message : "The workspace did not start.",
      );
    } finally {
      this.bootstrapPending = false;
    }
  }

  private showStartupState(title: string, description: string): void {
    const preload = document.querySelector<HTMLElement>(".theia-preload");
    if (!preload) return;

    preload.setAttribute("role", "status");
    preload.setAttribute("aria-live", "polite");
    preload.replaceChildren(this.startupPanel(title, description));
  }

  private showStartupFailure(description: string): void {
    const preload = document.querySelector<HTMLElement>(".theia-preload");
    if (!preload) return;

    const panel = this.startupPanel("Workspace could not start", description);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry workspace";
    Object.assign(retry.style, {
      marginTop: "18px",
      padding: "9px 14px",
      border: "1px solid rgba(255,255,255,.18)",
      borderRadius: "6px",
      background: "#2d6a4f",
      color: "#fff",
      cursor: "pointer",
      font: "600 13px system-ui, sans-serif",
    });
    retry.addEventListener("click", () => this.openSocket(), { once: true });
    panel.append(retry);

    preload.setAttribute("role", "alert");
    preload.replaceChildren(panel);
  }

  private startupPanel(title: string, description: string): HTMLDivElement {
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: "min(420px, calc(100vw - 48px))",
      transform: "translate(-50%, -50%)",
      color: "#f4f4f4",
      textAlign: "center",
      fontFamily: "system-ui, sans-serif",
    });

    const heading = document.createElement("strong");
    heading.textContent = title;
    Object.assign(heading.style, {
      display: "block",
      fontSize: "18px",
      lineHeight: "1.4",
    });

    const detail = document.createElement("p");
    detail.textContent = description;
    Object.assign(detail.style, {
      margin: "8px 0 0",
      color: "#b9b9b9",
      fontSize: "13px",
      lineHeight: "1.6",
    });

    panel.append(heading, detail);
    return panel;
  }
}
