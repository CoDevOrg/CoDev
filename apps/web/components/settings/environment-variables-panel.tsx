"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import type { EnvironmentVariable } from "@codev/contracts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function maskedValue(lastFour: string | null) {
  if (!lastFour) return "••••••••";
  return `••••${lastFour}`;
}

export function EnvironmentVariablesPanel({
  initialVariables,
}: {
  initialVariables: EnvironmentVariable[];
}) {
  const router = useRouter();
  const [variables, setVariables] = useState(initialVariables);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  function refreshList(next: EnvironmentVariable[]) {
    setVariables(next);
    router.refresh();
  }

  async function addVariable() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/settings/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value }),
    });
    const payload = (await response.json()) as {
      variable?: EnvironmentVariable;
      error?: string;
    };
    if (!response.ok || !payload.variable) {
      setMessage({
        tone: "warning",
        text: payload.error ?? "Could not save the variable.",
      });
      setBusy(false);
      return;
    }
    refreshList(
      [...variables, payload.variable].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    setName("");
    setValue("");
    setShowAdd(false);
    setMessage({ tone: "success", text: `${payload.variable.name} saved.` });
    setBusy(false);
  }

  async function saveEdit(variableId: string) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/settings/environment/${variableId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: editValue }),
    });
    const payload = (await response.json()) as {
      variable?: EnvironmentVariable;
      error?: string;
    };
    if (!response.ok || !payload.variable) {
      setMessage({
        tone: "warning",
        text: payload.error ?? "Could not update the variable.",
      });
      setBusy(false);
      return;
    }
    refreshList(
      variables.map((variable) =>
        variable.id === variableId ? payload.variable! : variable,
      ),
    );
    setEditingId(null);
    setEditValue("");
    setMessage({ tone: "success", text: `${payload.variable.name} updated.` });
    setBusy(false);
  }

  async function removeVariable(variable: EnvironmentVariable) {
    if (!window.confirm(`Delete ${variable.name}?`)) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/settings/environment/${variable.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setMessage({
        tone: "warning",
        text: payload?.error ?? "Could not delete the variable.",
      });
      setBusy(false);
      return;
    }
    refreshList(variables.filter((item) => item.id !== variable.id));
    setMessage({ tone: "success", text: `${variable.name} deleted.` });
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[46ch] text-sm text-muted-foreground">
          Values are encrypted at rest and never shown again after you save. Use
          them like a personal <code>.env</code> for CoDev workflows.
        </p>
        <Button
          disabled={busy}
          onClick={() => {
            setShowAdd((current) => !current);
            setMessage(null);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {showAdd ? "Cancel" : "Add"}
        </Button>
      </div>

      {showAdd ? (
        <FieldGroup className="rounded-md border border-border bg-background p-4">
          <Field>
            <FieldLabel htmlFor="env-key">Key</FieldLabel>
            <Input
              autoComplete="off"
              className="font-mono"
              id="env-key"
              onChange={(event) => setName(event.target.value.toUpperCase())}
              placeholder="DATABASE_URL"
              spellCheck={false}
              value={name}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="env-value">Value</FieldLabel>
            <Input
              autoComplete="off"
              className="font-mono"
              id="env-value"
              onChange={(event) => setValue(event.target.value)}
              placeholder="Sensitive value"
              spellCheck={false}
              type="password"
              value={value}
            />
          </Field>
          <Button
            className="w-fit"
            disabled={busy || !name.trim() || !value}
            onClick={() => void addVariable()}
            size="sm"
            type="button"
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </FieldGroup>
      ) : null}

      {variables.length === 0 && !showAdd ? (
        <Empty className="rounded-md border border-dashed border-border">
          <EmptyHeader>
            <EmptyTitle>No environment variables yet</EmptyTitle>
            <EmptyDescription>
              Add keys your agents and sandboxes should be able to use later.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul aria-label="Environment variables" className="flex flex-col gap-2">
          {variables.map((variable) => {
            const isEditing = editingId === variable.id;
            return (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                key={variable.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <code className="text-sm font-medium">{variable.name}</code>
                  {isEditing ? (
                    <Input
                      aria-label={`New value for ${variable.name}`}
                      autoComplete="off"
                      className="h-8 w-48 font-mono text-xs"
                      onChange={(event) => setEditValue(event.target.value)}
                      placeholder="Enter a new value"
                      spellCheck={false}
                      type="password"
                      value={editValue}
                    />
                  ) : (
                    <span className="font-mono text-xs tracking-wide text-muted-foreground">
                      {maskedValue(variable.lastFour)}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isEditing ? (
                    <>
                      <Button
                        disabled={busy || !editValue}
                        onClick={() => void saveEdit(variable.id)}
                        size="sm"
                        type="button"
                      >
                        Save
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setEditingId(null);
                          setEditValue("");
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        aria-label={`Edit ${variable.name}`}
                        disabled={busy}
                        onClick={() => {
                          setEditingId(variable.id);
                          setEditValue("");
                          setMessage(null);
                        }}
                        size="icon-sm"
                        type="button"
                        variant="secondary"
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        aria-label={`Delete ${variable.name}`}
                        disabled={busy}
                        onClick={() => void removeVariable(variable)}
                        size="icon-sm"
                        type="button"
                        variant="secondary"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {message ? (
        <Alert
          role={message.tone === "success" ? "status" : "alert"}
          variant={message.tone === "warning" ? "destructive" : "default"}
        >
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
