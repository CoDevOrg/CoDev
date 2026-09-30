"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";

import type { EnvironmentVariable } from "@codev/contracts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { useSettingsNotify } from "@/components/settings/settings-feedback";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [deleting, setDeleting] = useState<EnvironmentVariable | null>(null);
  const notify = useSettingsNotify();
  const [showAdd, setShowAdd] = useState(false);

  // A toast where the settings area provides one; the inline line otherwise.
  function report(next: { tone: "success" | "warning"; text: string }) {
    if (notify)
      notify(next.text, next.tone === "warning" ? "error" : "success");
    else setMessage(next);
  }

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
      report({
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
    report({ tone: "success", text: `${payload.variable.name} saved.` });
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
      report({
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
    report({ tone: "success", text: `${payload.variable.name} updated.` });
    setBusy(false);
  }

  async function removeVariable(variable: EnvironmentVariable) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/settings/environment/${variable.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      report({
        tone: "warning",
        text: payload?.error ?? "Could not delete the variable.",
      });
      setBusy(false);
      return;
    }
    refreshList(variables.filter((item) => item.id !== variable.id));
    report({ tone: "success", text: `${variable.name} deleted.` });
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 px-6 pt-6">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-base">Personal .env</CardTitle>
          <CardDescription>
            Encrypted at rest and write-only: values are never shown again after
            you save them. Available to your agents and sandboxes like a
            personal <code className="font-mono text-xs">.env</code>.
          </CardDescription>
        </div>
        {variables.length > 0 || showAdd ? (
          <Button
            className="shrink-0"
            disabled={busy}
            onClick={() => {
              setShowAdd((current) => !current);
              setMessage(null);
            }}
            size="sm"
            type="button"
            variant={showAdd ? "secondary" : "outline"}
          >
            {showAdd ? (
              "Cancel"
            ) : (
              <>
                <Plus aria-hidden="true" className="size-3.5" />
                Add variable
              </>
            )}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4 px-6 pt-5 pb-6">
        {showAdd ? (
          <form
            className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && name.trim() && value) void addVariable();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="env-name">Name</Label>
                <Input
                  autoComplete="off"
                  autoFocus
                  className="font-mono"
                  id="env-name"
                  onChange={(event) =>
                    setName(event.target.value.toUpperCase())
                  }
                  placeholder="DATABASE_URL"
                  spellCheck={false}
                  value={name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="env-value">Value</Label>
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
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                disabled={busy}
                onClick={() => setShowAdd(false)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={busy || !name.trim() || !value}
                size="sm"
                type="submit"
              >
                {busy ? "Saving…" : "Save variable"}
              </Button>
            </div>
          </form>
        ) : null}

        {variables.length === 0 && !showAdd ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <KeyRound aria-hidden="true" className="size-5" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">No variables yet</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Add the keys and settings your agents and sandboxes need, such
                as <code className="font-mono text-xs">DATABASE_URL</code>.
              </p>
            </div>
            <Button
              onClick={() => {
                setShowAdd(true);
                setMessage(null);
              }}
              size="sm"
              type="button"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Add variable
            </Button>
          </div>
        ) : null}

        {variables.length > 0 ? (
          <ul
            aria-label="Environment variables"
            className="divide-y divide-border overflow-hidden rounded-lg border border-border"
          >
            {variables.map((variable) => {
              const isEditing = editingId === variable.id;
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  key={variable.id}
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                    <code className="text-sm font-medium break-all">
                      {variable.name}
                    </code>
                    {isEditing ? (
                      <Input
                        aria-label={`New value for ${variable.name}`}
                        autoComplete="off"
                        autoFocus
                        className="h-8 max-w-64 font-mono text-xs"
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
                          title="Replace value"
                          type="button"
                          variant="secondary"
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                        </Button>
                        <Button
                          aria-label={`Delete ${variable.name}`}
                          className="hover:text-destructive"
                          disabled={busy}
                          onClick={() => setDeleting(variable)}
                          size="icon-sm"
                          title="Delete"
                          type="button"
                          variant="secondary"
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {message ? (
          <p
            className={`text-sm ${message.tone === "warning" ? "text-destructive" : "text-muted-foreground"}`}
            role={message.tone === "success" ? "status" : "alert"}
          >
            {message.text}
          </p>
        ) : null}
      </CardContent>

      {deleting ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Delete variable"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            void removeVariable(target);
          }}
          title={`Delete ${deleting.name}?`}
        >
          Agents and sandboxes lose access to this value. This cannot be undone.
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
