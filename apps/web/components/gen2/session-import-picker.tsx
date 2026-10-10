"use client";

import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";

import type { Gen2SessionImportProvider } from "@codev/contracts";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { canBrowseLocalSessions } from "@/lib/gen2/session-import-scan";

import { ProviderLogo } from "./provider-logos";
import { SessionImportBrowser } from "./session-import-browser";
import {
  currentPlatform,
  PICKER_TIP,
  SESSION_SOURCES,
} from "./session-import-sources";

/**
 * Chooses the agent and the session: from a browsable list where the browser
 * allows folder access (Chrome, Edge), otherwise or additionally a file.
 */
export function SessionImportPicker({
  provider,
  onProviderChange,
  pending,
  onFile,
}: {
  provider: Gen2SessionImportProvider;
  onProviderChange: (provider: Gen2SessionImportProvider) => void;
  pending: boolean;
  onFile: (file: File | undefined) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const platform = currentPlatform();
  const source = SESSION_SOURCES[provider];
  const folder = source.folder[platform];
  const browsable = canBrowseLocalSessions();

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Agent</FieldLabel>
        <ToggleGroup
          type="single"
          value={provider}
          onValueChange={(value) =>
            value && onProviderChange(value as Gen2SessionImportProvider)
          }
        >
          {(["codex", "claude"] as const).map((id) => (
            <ToggleGroupItem key={id} value={id}>
              <ProviderLogo provider={id} size={14} />
              {SESSION_SOURCES[id].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      {browsable ? (
        <Field>
          <FieldLabel>Your {source.label} sessions</FieldLabel>
          <FieldDescription>
            Choose the folder once to list its sessions. Only the session you
            pick is uploaded. {PICKER_TIP[platform]}
          </FieldDescription>
          <SessionImportBrowser
            key={provider}
            provider={provider}
            folder={folder}
            disabled={pending}
            onPick={onFile}
          />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="session-import-file">
          {browsable ? "Or upload a session file" : "Session file"}
        </FieldLabel>
        <FieldDescription>
          Find it in <code>{folder}</code> as{" "}
          <code>{source.file[platform]}</code>.
          {provider === "claude" ? " Skip files in subagents folders." : ""}
          {browsable ? "" : ` ${PICKER_TIP[platform]}`} Up to 64 MB.
          {browsable
            ? ""
            : " To pick from a list of your sessions instead, open CoDev in Chrome or Edge."}
        </FieldDescription>
        <label
          htmlFor="session-import-file"
          className="gen2-session-import-drop"
          data-compact={browsable || undefined}
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            onFile(event.dataTransfer.files[0]);
          }}
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <FileUp aria-hidden="true" />
          )}
          <span>
            {pending
              ? "Reading and redacting…"
              : "Drop a .jsonl file here, or click to choose"}
          </span>
        </label>
        <input
          id="session-import-file"
          type="file"
          accept=".jsonl,application/x-ndjson,application/json"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </Field>
    </FieldGroup>
  );
}
