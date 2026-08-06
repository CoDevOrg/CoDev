import { WebSocketConnectionSource } from "@theia/core/lib/browser/messaging/ws-connection-source";
import { injectable } from "@theia/core/shared/inversify";

const WORKSPACE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@injectable()
export class CoDevConnectionSource extends WebSocketConnectionSource {
  override openSocket(): void {
    const workspaceId = this.workspaceId();
    if (!workspaceId) {
      super.openSocket();
      return;
    }
    void fetch(`/api/workspaces/${workspaceId}/theia/bootstrap`, {
      credentials: "same-origin",
      cache: "no-store",
    }).finally(() => super.openSocket());
  }

  protected override createSocketIoPath(url: string): string | undefined {
    const workspaceId = this.workspaceId();
    if (!workspaceId) {
      return super.createSocketIoPath(url);
    }
    return `/api/workspaces/${workspaceId}/theia/socket.io`;
  }

  private workspaceId(): string | undefined {
    const value = new URLSearchParams(window.location.search).get(
      "workspaceId",
    );
    return value && WORKSPACE_ID.test(value) ? value : undefined;
  }
}
