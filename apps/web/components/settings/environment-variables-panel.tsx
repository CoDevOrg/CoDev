"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardPaste, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import {
  environmentNameError,
  parseDotenv,
} from "@/components/settings/parse-dotenv";

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
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const nameError = environmentNameError(name);
  const parsedImport = parseDotenv(importText);

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

  /**
   * Pasted .env text is saved one variable at a time through the same route as
   * a single add, so every server-side rule (limit, duplicate names, size)
   * applies unchanged; the result is one summary rather than a toast per line.
   */
  async function importVariables() {
    if (parsedImport.entries.length === 0) return;
    setBusy(true);
    setMessage(null);
    const saved: EnvironmentVariable[] = [];
    const failed: string[] = [];
    for (const entry of parsedImport.entries) {
      const response = await fetch("/api/settings/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        variable?: EnvironmentVariable;
      };
      if (response.ok && payload.variable) saved.push(payload.variable);
      else failed.push(entry.name);
    }
    if (saved.length > 0) {
      refreshList(
        [...variables, ...saved].sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
    if (failed.length === 0) {
      setImportText("");
      setShowImport(false);
    }
    const parts = [
      saved.length > 0
        ? `Imported ${saved.length} variable${saved.length === 1 ? "" : "s"}.`
        : null,
      failed.length > 0
        ? `Not imported (already exist or over the limit): ${failed.join(", ")}.`
        : null,
    ].filter(Boolean);
    report({
      tone: failed.length > 0 ? "warning" : "success",
      text: parts.join(" "),
    });
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
            you save them. They are passed to every Gen 2 agent session you
            start, like a personal{" "}
            <code className="font-mono text-xs">.env</code>. Your provider login
            always wins over a variable with the same name.
          </CardDescription>
        </div>
        {variables.length > 0 || showAdd || showImport ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                setShowImport((current) => !current);
                setShowAdd(false);
                setMessage(null);
              }}
              size="sm"
              type="button"
              variant={showImport ? "secondary" : "outline"}
            >
              <ClipboardPaste aria-hidden="true" className="size-3.5" />
              Paste .env
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setShowAdd((current) => !current);
                setShowImport(false);
                setMessage(null);
              }}
              size="sm"
              type="button"
              variant={showAdd ? "secondary" : "outline"}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Add variable
            </Button>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4 px-6 pt-5 pb-6">
        {showAdd ? (
          <form
            className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && name.trim() && value && !nameError)
                void addVariable();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="env-name">Name</Label>
                <Input
                  autoComplete="off"
                  autoFocus
                  className="font-mono"
                  aria-describedby={nameError ? "env-name-error" : undefined}
                  aria-invalid={nameError ? true : undefined}
                  id="env-name"
                  onChange={(event) =>
                    setName(event.target.value.toUpperCase())
                  }
                  placeholder="DATABASE_URL"
                  spellCheck={false}
                  value={name}
                />
                {nameError ? (
                  <p
                    className="text-xs text-destructive"
                    id="env-name-error"
                    role="alert"
                  >
                    {nameError}
                  </p>
                ) : null}
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
                disabled={busy || !name.trim() || !value || nameError !== null}
                size="sm"
                type="submit"
              >
                {busy ? "Saving…" : "Save variable"}
              </Button>
            </div>
          </form>
        ) : null}

        {showImport ? (
          <form
            className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void importVariables();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="env-import">Paste your .env</Label>
              <Textarea
                autoFocus
                className="min-h-32 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                id="env-import"
                onChange={(event) => setImportText(event.target.value)}
                placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=..."}
                spellCheck={false}
                value={importText}
              />
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {importText.trim()
                  ? `${parsedImport.entries.length} variable${parsedImport.entries.length === 1 ? "" : "s"} ready${parsedImport.skipped.length > 0 ? `; line${parsedImport.skipped.length === 1 ? "" : "s"} ${parsedImport.skipped.join(", ")} can't be used and will be skipped` : ""}. Existing names are not overwritten.`
                  : "One NAME=value per line. Comments and export prefixes are fine."}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                disabled={busy}
                onClick={() => setShowImport(false)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={busy || parsedImport.entries.length === 0}
                size="sm"
                type="submit"
              >
                {busy ? "Importing…" : "Import variables"}
              </Button>
            </div>
          </form>
        ) : null}

        {variables.length === 0 && !showAdd && !showImport ? (
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
            <button
              className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => {
                setShowImport(true);
                setMessage(null);
              }}
              type="button"
            >
              or paste a .env file
            </button>
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
