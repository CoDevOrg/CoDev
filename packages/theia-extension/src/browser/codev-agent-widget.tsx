import * as React from "react";
import { injectable, postConstruct } from "inversify";
import { ReactWidget } from "@theia/core/lib/browser";

@injectable()
export class CoDevAgentWidget extends ReactWidget {
  static readonly ID = "codev-agent-widget";
  static readonly LABEL = "CoDev Agent";

  @postConstruct()
  protected init(): void {
    this.id = CoDevAgentWidget.ID;
    this.title.label = CoDevAgentWidget.LABEL;
    this.title.caption = "CoDev AI Agent Co-Steering";
    this.title.closable = true;
    this.title.iconClass = "fa fa-robot";
    this.update();
  }

  protected render(): React.ReactNode {
    return <CoDevAgentWidgetComponent />;
  }
}

function CoDevAgentWidgetComponent() {
  const [prompt, setPrompt] = React.useState("");
  const [selectedModel, setSelectedModel] = React.useState("claude-3-7-sonnet");
  const [status, setStatus] = React.useState<"idle" | "running">("idle");
  const [turns, setTurns] = React.useState<
    { id: string; role: "user" | "agent"; text: string }[]
  >([]);

  const handleSend = () => {
    if (!prompt.trim() || status === "running") return;
    const userMsg = {
      id: String(Date.now()),
      role: "user" as const,
      text: prompt.trim(),
    };
    setTurns((prev) => [...prev, userMsg]);
    setPrompt("");
    setStatus("running");

    // Simulate agent streaming response
    setTimeout(() => {
      setTurns((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          role: "agent" as const,
          text: `Executing task using ${selectedModel} in Firecracker VM sandbox...`,
        },
      ]);
      setStatus("idle");
    }, 1200);
  };

  return (
    <div
      className="codev-agent-panel-container"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "14px",
        boxSizing: "border-box",
        fontFamily: "var(--theia-ui-font-family, system-ui, sans-serif)",
        color: "var(--theia-ui-padding)",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid var(--theia-divider, rgba(255,255,255,0.1))",
          paddingBottom: "10px",
          marginBottom: "12px",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
          CoDev AI Agent
        </h3>
        <span style={{ fontSize: "11px", opacity: 0.75 }}>
          Multiplayer Co-Steering Engine
        </span>
      </header>

      <div
        className="codev-agent-status-badge"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "rgba(59, 168, 121, 0.12)",
          color: "#3ba879",
          padding: "6px 10px",
          borderRadius: "6px",
          fontSize: "11px",
          fontWeight: 600,
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "#3ba879",
          }}
        />
        MicroVM Sandbox Ready
      </div>

      <div
        className="codev-agent-timeline"
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          marginBottom: "12px",
          paddingRight: "4px",
        }}
      >
        {turns.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: "12px", margin: "12px 0" }}>
            No turns yet. Enter a task below for the agent to construct or
            refactor code.
          </p>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              style={{
                background:
                  turn.role === "user"
                    ? "var(--theia-button-background, #005fb8)"
                    : "var(--theia-editor-background, rgba(255,255,255,0.05))",
                color:
                  turn.role === "user"
                    ? "var(--theia-button-foreground, #fff)"
                    : "inherit",
                padding: "8px 12px",
                borderRadius: "8px",
                fontSize: "12px",
                lineHeight: "1.45",
                alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "88%",
              }}
            >
              <strong>{turn.role === "user" ? "You" : "CoDev Agent"}:</strong>{" "}
              {turn.text}
            </div>
          ))
        )}
      </div>

      <div
        className="codev-agent-composer"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          borderTop: "1px solid var(--theia-divider, rgba(255,255,255,0.1))",
          paddingTop: "10px",
        }}
      >
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          aria-label="Select AI Model"
          style={{
            background: "var(--theia-dropdown-background, rgba(0,0,0,0.2))",
            color: "var(--theia-dropdown-foreground, inherit)",
            border:
              "1px solid var(--theia-dropdown-border, rgba(255,255,255,0.15))",
            borderRadius: "5px",
            padding: "5px 8px",
            fontSize: "11px",
          }}
        >
          <option value="claude-3-7-sonnet">Anthropic Claude 3.7 Sonnet</option>
          <option value="gpt-4o">OpenAI GPT-4o</option>
          <option value="cursor-fast">Cursor Fast</option>
        </select>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask agent to build feature..."
          rows={3}
          style={{
            background: "var(--theia-input-background, rgba(0,0,0,0.2))",
            color: "var(--theia-input-foreground, inherit)",
            border:
              "1px solid var(--theia-input-border, rgba(255,255,255,0.15))",
            borderRadius: "6px",
            padding: "8px",
            fontSize: "12px",
            resize: "none",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!prompt.trim() || status === "running"}
          style={{
            background: "var(--theia-button-background, #005fb8)",
            color: "var(--theia-button-foreground, #fff)",
            border: "none",
            borderRadius: "6px",
            padding: "7px 12px",
            fontSize: "12px",
            fontWeight: 600,
            cursor:
              prompt.trim() && status !== "running" ? "pointer" : "not-allowed",
            opacity: prompt.trim() && status !== "running" ? 1 : 0.6,
          }}
        >
          {status === "running"
            ? "Agent running..."
            : "Send to Agent (⌘+Enter)"}
        </button>
      </div>
    </div>
  );
}
