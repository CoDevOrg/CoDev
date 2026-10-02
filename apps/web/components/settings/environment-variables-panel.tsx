"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardPaste, Pencil, Plus, Trash2 } from "lucide-react";

import type { EnvironmentVariable } from "@codev/contracts";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import {
  environmentNameError,
  parseDotenv,
} from "@/components/settings/parse-dotenv";
import { useSettingsNotify } from "@/components/settings/settings-feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

function maskedValue(lastFour: string | null) {
  if (!lastFour) return "••••••••";
  return `••••${lastFour}`;
}

type Mode = "closed" | "add" | "import";

export function EnvironmentVariablesPanel({
  initialVariables,
}: {
  initialVariables: EnvironmentVariable[];
}) {
  const router = useRouter();
  const notify = useSettingsNotify();
  const [variables, setVariables] = useState(initialVariables);
  const [mode, setMode] = useState<Mode>("closed");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [importText, setImportText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleting, setDeleting] = useState<EnvironmentVariable | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const nameError = environmentNameError(name);
  const parsedImport = parseDotenv(importText);

  // A toast where the settings area provides one; an inline alert otherwise.
  function report(next: { tone: "success" | "warning"; text: string }) {
    if (notify) {
      notify(next.text, next.tone === "warning" ? "error" : "success");
    } else {
      setMessage(next);
    }
  }

  function refreshList(next: EnvironmentVariable[]) {
    setVariables(next);
    router.refresh();
  }

  function open(next: Mode) {
    setMode((current) => (current === next ? "closed" : next));
    setMessage(null);
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
    setMode("closed");
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
      setMode("closed");
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

  const showEmpty = variables.length === 0 && mode === "closed";

  return (
    <div className="flex flex-col gap-4">
      {variables.length > 0 || mode !== "closed" ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            disabled={busy}
            onClick={() => open("import")}
            size="sm"
            type="button"
            variant={mode === "import" ? "secondary" : "outline"}
          >
            <ClipboardPaste aria-hidden="true" data-icon="inline-start" />
            Paste .env
          </Button>
          <Button
            disabled={busy}
            onClick={() => open("add")}
            size="sm"
            type="button"
            variant={mode === "add" ? "secondary" : "outline"}
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            Add variable
          </Button>
        </div>
      ) : null}

      {mode === "add" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && name.trim() && value && !nameError) {
              void addVariable();
            }
          }}
        >
          <FieldGroup className="rounded-md border border-border bg-background p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="env-key">Name</FieldLabel>
                <Input
                  aria-describedby={nameError ? "env-key-error" : undefined}
                  aria-invalid={nameError ? true : undefined}
                  autoComplete="off"
                  autoFocus
                  className="font-mono"
                  id="env-key"
                  onChange={(event) =>
                    setName(event.target.value.toUpperCase())
                  }
                  placeholder="DATABASE_URL"
                  spellCheck={false}
                  value={name}
                />
                {nameError ? (
                  <FieldDescription
                    className="text-destructive"
                    id="env-key-error"
                    role="alert"
                  >
                    {nameError}
                  </FieldDescription>
                ) : null}
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
            </div>
            <div className="flex justify-end gap-2">
              <Button
                disabled={busy}
                onClick={() => setMode("closed")}
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
          </FieldGroup>
        </form>
      ) : null}

      {mode === "import" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void importVariables();
          }}
        >
          <FieldGroup className="rounded-md border border-border bg-background p-4">
            <Field>
              <FieldLabel htmlFor="env-import">Paste your .env</FieldLabel>
              <Textarea
                autoFocus
                className="min-h-32 resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                id="env-import"
                onChange={(event) => setImportText(event.target.value)}
                placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=..."}
                spellCheck={false}
                value={importText}
              />
              <FieldDescription aria-live="polite">
                {importText.trim()
                  ? `${parsedImport.entries.length} variable${parsedImport.entries.length === 1 ? "" : "s"} ready${
                      parsedImport.skipped.length > 0
                        ? `; line${parsedImport.skipped.length === 1 ? "" : "s"} ${parsedImport.skipped.join(", ")} can't be used and will be skipped`
                        : ""
                    }. Existing names are not overwritten.`
                  : "One NAME=value per line. Comments and export prefixes are fine."}
              </FieldDescription>
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                disabled={busy}
                onClick={() => setMode("closed")}
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
          </FieldGroup>
        </form>
      ) : null}

      {showEmpty ? (
        <Empty className="rounded-md border border-dashed border-border">
          <EmptyHeader>
            <EmptyTitle>No variables yet</EmptyTitle>
            <EmptyDescription>
              Add the keys and settings your agents and sandboxes need, such as{" "}
              <code>DATABASE_URL</code>.
            </EmptyDescription>
          </EmptyHeader>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => open("add")} size="sm" type="button">
              <Plus aria-hidden="true" data-icon="inline-start" />
              Add variable
            </Button>
            <Button
              onClick={() => open("import")}
              size="sm"
              type="button"
              variant="outline"
            >
              <ClipboardPaste aria-hidden="true" data-icon="inline-start" />
              Paste .env
            </Button>
          </div>
        </Empty>
      ) : null}

      {variables.length > 0 ? (
        <ul
          aria-label="Environment variables"
          className="overflow-hidden rounded-md border border-border"
        >
          {variables.map((variable, index) => {
            const isEditing = editingId === variable.id;
            return (
              <li key={variable.id}>
                {index > 0 ? <Separator /> : null}
                <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
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
                          <Pencil aria-hidden="true" />
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
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {message ? (
        <Alert
          role={message.tone === "success" ? "status" : "alert"}
          variant={message.tone === "warning" ? "destructive" : "default"}
        >
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

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
    </div>
  );
}
