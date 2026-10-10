"use client";

import { useState, type FormEvent } from "react";
import type { Gen2SupersetWorktree } from "@codev/contracts";

import { branchBaseFor, createWorktreeFrom } from "./create-worktree";
import { openRemoteBranch, worktreeIdForBranch } from "./open-remote-branch";
import { useRemoteBranches } from "./use-remote-branches";
import { WorkspaceButton } from "./workspace-button";
import { DETACHED_BRANCH, worktreeDisplay } from "./worktree-display";
import {
  NEW_BRANCH,
  worktreeFolderName,
  worktreeFormProblem,
} from "./workspace-worktree-checks";

const CURRENT_BASE = "__current__";

type FormProps = {
  workspaceId: string;
  worktrees: Gen2SupersetWorktree[];
  currentWorktreeId: string;
  /** The machine cannot fetch a private repository's other branches. */
  repositoryPrivate: boolean;
  onCreated: (created: Gen2SupersetWorktree) => void;
  onCancel: () => void;
};

/** Creates the worktree: a new branch, or a GitHub branch checked out. */
function createFromChoice(
  props: FormProps,
  input: {
    choice: string;
    target: string;
    folder: string | undefined;
    baseRef: string | undefined;
  },
) {
  return input.choice === NEW_BRANCH
    ? createWorktreeFrom(
        props.workspaceId,
        {
          branch: input.target,
          worktreeId: input.folder,
          baseRef: input.baseRef,
        },
        props.worktrees,
      )
    : openRemoteBranch(
        props.workspaceId,
        input.target,
        props.worktrees,
        input.folder,
      );
}

/** The form's fields and what follows from them. */
function useWorktreeFields(props: FormProps) {
  const remote = useRemoteBranches(props.workspaceId, true);
  const [choice, setChoice] = useState(NEW_BRANCH);
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState(CURRENT_BASE);
  const [name, setName] = useState("");
  const taken = props.worktrees.map((worktree) => worktree.worktreeId);
  const target = choice === NEW_BRANCH ? branch.trim() : choice;
  const typedFolder = worktreeFolderName(name);
  const current =
    props.worktrees.find(
      (worktree) => worktree.worktreeId === props.currentWorktreeId,
    ) ?? props.worktrees[0];
  return {
    ...{ remote, choice, setChoice, branch, setBranch, base, setBase },
    ...{ name, setName, target, typedFolder, current },
    folder: typedFolder || (target ? worktreeIdForBranch(target, taken) : ""),
    problem: worktreeFormProblem(
      { choice, target, folder: typedFolder },
      props.worktrees,
    ),
    remoteNames: props.repositoryPrivate
      ? []
      : (remote.list?.branches ?? []).map((entry) => entry.name),
    baseRef:
      base !== CURRENT_BASE
        ? base
        : current
          ? branchBaseFor(current, props.worktrees).baseRef
          : undefined,
  };
}

function useWorktreeForm(props: FormProps) {
  const fields = useWorktreeFields(props);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fields.target || fields.problem || busy) return;
    setBusy(true);
    setError("");
    try {
      props.onCreated(
        await createFromChoice(props, {
          choice: fields.choice,
          target: fields.target,
          folder: fields.typedFolder || undefined,
          baseRef: fields.baseRef,
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Couldn’t create this worktree.",
      );
    } finally {
      setBusy(false);
    }
  }

  return { ...fields, busy, error, submit };
}

/** The branch choices: a new branch, or a GitHub branch not open already. */
function BranchChoice({
  form,
  worktrees,
}: {
  form: ReturnType<typeof useWorktreeForm>;
  worktrees: Gen2SupersetWorktree[];
}) {
  const open = new Set(worktrees.map((worktree) => worktree.branch));
  const available = form.remoteNames.filter((name) => !open.has(name));
  return (
    <label>
      Branch
      <select
        className="gen2-workspace-select"
        value={form.choice}
        onChange={(event) => form.setChoice(event.target.value)}
      >
        <option value={NEW_BRANCH}>New branch…</option>
        {available.length ? (
          <optgroup label="On GitHub">
            {available.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}

/** Where a new branch starts: this worktree, another one, or GitHub's default. */
function BaseChoice({
  form,
  worktrees,
}: {
  form: ReturnType<typeof useWorktreeForm>;
  worktrees: Gen2SupersetWorktree[];
}) {
  const others = worktrees.filter(
    (worktree) =>
      worktree.worktreeId !== form.current?.worktreeId &&
      worktree.branch !== DETACHED_BRANCH,
  );
  const defaultBranch = form.remote.list?.defaultBranch;
  return (
    <label>
      Start from
      <select
        className="gen2-workspace-select"
        value={form.base}
        onChange={(event) => form.setBase(event.target.value)}
      >
        <option value={CURRENT_BASE}>
          This worktree
          {form.current ? ` (${worktreeDisplay(form.current).text})` : ""}
        </option>
        {others.map((worktree) => (
          <option key={worktree.worktreeId} value={worktree.branch}>
            {worktreeDisplay(worktree).text}
          </option>
        ))}
        {defaultBranch ? (
          <option value={`origin/${defaultBranch}`}>
            {defaultBranch} on GitHub
          </option>
        ) : null}
      </select>
    </label>
  );
}

/** A new branch's name and where it starts. */
function NewBranchFields({
  form,
  worktrees,
}: {
  form: ReturnType<typeof useWorktreeForm>;
  worktrees: Gen2SupersetWorktree[];
}) {
  return (
    <>
      <label>
        New branch name
        <input
          value={form.branch}
          onChange={(event) => form.setBranch(event.target.value)}
          placeholder="feature/login"
          aria-invalid={form.problem ? true : undefined}
          autoFocus
          required
        />
      </label>
      <BaseChoice form={form} worktrees={worktrees} />
    </>
  );
}

/**
 * The rail's "New worktree" form: pick a branch from GitHub or name a new
 * one, and optionally the folder. Branches already open elsewhere are left
 * out, because Git allows a branch in one worktree at a time.
 */
export function WorkspaceWorktreeForm(props: FormProps) {
  const form = useWorktreeForm(props);
  const message = form.problem || form.error;
  return (
    <form
      className="gen2-ide-branch-form"
      aria-label="New worktree"
      onSubmit={(event) => void form.submit(event)}
    >
      <BranchChoice form={form} worktrees={props.worktrees} />
      {form.remote.status === "loading" && !form.remote.list ? (
        <p className="gen2-worktree-form-hint">Loading branches from GitHub…</p>
      ) : null}
      {form.choice === NEW_BRANCH ? (
        <NewBranchFields form={form} worktrees={props.worktrees} />
      ) : null}
      <label>
        Folder name <span>(optional)</span>
        <input
          value={form.name}
          onChange={(event) => form.setName(event.target.value)}
          placeholder={form.folder || "login-fix"}
        />
      </label>
      {message ? (
        <p className="gen2-worktree-form-error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="gen2-worktree-create-actions">
        <WorkspaceButton
          tone="primary"
          type="submit"
          disabled={form.busy || Boolean(form.problem) || !form.folder}
          className="gen2-worktree-form-submit-btn"
        >
          {form.busy ? "Creating…" : "Create worktree"}
        </WorkspaceButton>
        <WorkspaceButton
          tone="ghost"
          type="button"
          onClick={props.onCancel}
          className="gen2-worktree-form-cancel-btn"
        >
          Cancel
        </WorkspaceButton>
      </div>
    </form>
  );
}
