"use client";

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ChatModelAdapter,
  type ThreadAssistantMessagePart,
  type ThreadMessage,
  type ToolCallMessagePartProps,
  useLocalRuntime,
} from "@assistant-ui/react";
import { useCallback, useMemo, useState } from "react";

import { ReportAgentBug, type AgentBugReportContext } from "./report-agent-bug";

type WireEvent = {
  kind: "text" | "tool-call" | "tool-result" | "error";
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  message?: string;
};

function textFromMessage(message: ThreadMessage) {
  return message.content
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

function createAgentModel(
  workspaceId: string,
  addCycle: (cycle: { prompt: string; response: string }) => void,
  addTerminalError: (error: string) => void,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const prompt = textFromMessage(messages.at(-1) as ThreadMessage);
      const response = await fetch(
        `/api/workspaces/${workspaceId}/agents/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: abortSignal,
        },
      );
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        const message =
          body?.error ?? `Agent request failed (${response.status}).`;
        addTerminalError(message);
        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      const tools = new Map<
        string,
        ThreadAssistantMessagePart & { type: "tool-call" }
      >();

      const parts = (): ThreadAssistantMessagePart[] => [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...tools.values(),
      ];

      const consume = (event: WireEvent) => {
        if (event.kind === "text") {
          text += event.delta ?? "";
        } else if (event.kind === "tool-call" && event.toolCallId) {
          const args = event.args ?? {};
          tools.set(event.toolCallId, {
            type: "tool-call",
            toolCallId: event.toolCallId,
            toolName: event.toolName ?? "workspace tool",
            args: args as never,
            argsText: JSON.stringify(args),
          });
        } else if (event.kind === "tool-result" && event.toolCallId) {
          const current = tools.get(event.toolCallId);
          if (current) {
            tools.set(event.toolCallId, {
              ...current,
              result: event.result,
            });
          }
        } else if (event.kind === "error") {
          const message = event.message ?? "Agent stream failed.";
          addTerminalError(message);
          throw new Error(message);
        }
      };

      while (true) {
        const read = await reader.read();
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          consume(JSON.parse(line) as WireEvent);
          yield { content: parts() };
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        consume(JSON.parse(buffer) as WireEvent);
        yield { content: parts() };
      }
      addCycle({ prompt, response: text });
    },
  };
}

function AgentToolCard({
  toolName,
  args,
  result,
  status,
}: ToolCallMessagePartProps) {
  const argsRecord =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)
      : {};
  const diff =
    typeof argsRecord.diffContent === "string"
      ? argsRecord.diffContent
      : typeof result === "object" &&
          result !== null &&
          typeof (result as Record<string, unknown>).diffContent === "string"
        ? ((result as Record<string, unknown>).diffContent as string)
        : null;
  return (
    <div className="agent-canvas-tool-card">
      <div>
        <strong>{toolName}</strong>
        <span>{status.type === "running" ? "running" : "complete"}</span>
      </div>
      <code>{JSON.stringify(args)}</code>
      {diff ? <pre>{diff}</pre> : null}
      {result ? <small>{JSON.stringify(result)}</small> : null}
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="agent-canvas-message user">
      <MessagePrimitive.Content />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="agent-canvas-message assistant">
      <MessagePrimitive.Content
        components={{ tools: { Fallback: AgentToolCard } }}
      />
    </MessagePrimitive.Root>
  );
}

export function AgentCanvas({ workspaceId }: { workspaceId: string }) {
  const [cycles, setCycles] = useState<AgentBugReportContext["cycles"]>([]);
  const [terminalErrors, setTerminalErrors] = useState<
    AgentBugReportContext["terminalErrors"]
  >([]);
  const addCycle = useCallback(
    (cycle: AgentBugReportContext["cycles"][number]) => {
      setCycles((current) => [...current, cycle].slice(-5));
    },
    [],
  );
  const addTerminalError = useCallback((error: string) => {
    setTerminalErrors((current) => [...current, error].slice(-20));
  }, []);
  const model = useMemo(
    () => createAgentModel(workspaceId, addCycle, addTerminalError),
    [addCycle, addTerminalError, workspaceId],
  );
  const runtime = useLocalRuntime(model);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <section className="agent-canvas" aria-label="Agent-first canvas">
        <div className="agent-canvas-header">
          <div>
            <span className="eyebrow">Agent-first canvas</span>
            <h2>Build with the workspace agent</h2>
          </div>
          <div className="agent-canvas-header-actions">
            <span className="agent-canvas-status">
              streaming · tools · diffs
            </span>
            <ReportAgentBug
              workspaceId={workspaceId}
              getContext={() => ({ cycles, terminalErrors })}
            />
          </div>
        </div>
        <ThreadPrimitive.Root className="agent-canvas-thread">
          <ThreadPrimitive.Viewport autoScroll>
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="agent-canvas-composer">
            <ComposerPrimitive.Input placeholder="Ask the agent to inspect or change the workspace…" />
            <ComposerPrimitive.Cancel className="agent-canvas-cancel">
              Pause
            </ComposerPrimitive.Cancel>
            <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </section>
    </AssistantRuntimeProvider>
  );
}
