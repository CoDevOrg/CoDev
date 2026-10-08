import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { workspaceBootstrap } from "./scripts/arm-workspace-bootstrap.mjs";

const source = { repositoryUrl: null, baseSha: "a".repeat(40) };
const file = (path, contents, mode = "100644") => ({
  path,
  mode,
  contentBase64: Buffer.from(contents).toString("base64"),
});
async function fixture(t, fresh = true) {
  const root = await mkdtemp(join(tmpdir(), "codev-bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = join(root, ".codev-runtime", "bootstrap");
  await mkdir(stage, { recursive: true });
  if (fresh) await writeFile(join(stage, "new-disk"), "");
  return {
    root,
    stage,
    initialize: workspaceBootstrap(
      root,
      async () => {},
      execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim(),
    ),
  };
}

test("a private snapshot becomes a Git checkout and reopen preserves edits", async (t) => {
  const { root, initialize } = await fixture(t);
  await initialize(source);
  await initialize({ ...source, file: file("src/main.ts", "saved") });
  await initialize({ ...source, complete: true });
  assert.equal(await readFile(join(root, "src/main.ts"), "utf8"), "saved");
  await writeFile(join(root, "src/main.ts"), "member edits");
  assert.deepEqual(await initialize({ ...source, complete: true }), {
    initialized: true,
  });
  assert.equal(
    await readFile(join(root, "src/main.ts"), "utf8"),
    "member edits",
  );
});

test("missing saved checkout never permits a fresh initialization", async (t) => {
  const { initialize } = await fixture(t, false);
  await assert.rejects(initialize(source), /SAVED_CHECKOUT_MISSING/);
});

test("existing files are preserved when initialization conflicts", async (t) => {
  const { root, initialize } = await fixture(t);
  await writeFile(join(root, "README.md"), "saved");
  await initialize({ ...source, file: file("README.md", "replacement") });
  await assert.rejects(
    initialize({ ...source, complete: true }),
    /SAVED_CHECKOUT_CONFLICT/,
  );
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "saved");
});

test("snapshot paths cannot traverse symlinks or private metadata", async (t) => {
  const { root, stage, initialize } = await fixture(t);
  for (const path of [
    "../outside",
    ".git/config",
    ".codev-runtime/complete",
    "foo/../../outside",
    "foo\\bar",
  ]) {
    await assert.rejects(
      initialize({ ...source, file: file(path, "bad") }),
      /INVALID_PATH/,
    );
  }
  await symlink(root, join(stage, "checkout", "escape"));
  await assert.rejects(
    initialize({ ...source, file: file("escape/outside", "bad") }),
    /INVALID_PATH/,
  );
  await assert.rejects(readFile(join(root, "outside")), { code: "ENOENT" });
});

test("an interrupted publish resumes without replacing moved files", async (t) => {
  const { root, stage, initialize } = await fixture(t);
  await initialize({ ...source, file: file("README.md", "saved") });
  const checkout = join(stage, "checkout");
  await writeFile(
    join(stage, "publishing"),
    JSON.stringify([".git", "README.md"]),
  );
  await rename(join(checkout, "README.md"), join(root, "README.md"));
  await initialize({ ...source, complete: true });
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "saved");
});

test("source identity cannot change during initialization", async (t) => {
  const { initialize } = await fixture(t);
  await initialize(source);
  await assert.rejects(
    initialize({ ...source, baseSha: "b".repeat(40) }),
    /SOURCE_MISMATCH/,
  );
});

test("public repositories are cloned blobless at the base commit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codev-bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = join(root, ".codev-runtime", "bootstrap");
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, "new-disk"), "");
  const log = join(root, "git-calls");
  const fakeGit = join(root, "fake-git");
  // Records each call; a clone creates its target like the real one would.
  await writeFile(
    fakeGit,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n[ "$1" = clone ] && mkdir -p "$(eval echo \\\${$#})"\nexit 0\n`,
    { mode: 0o755 },
  );
  const initialize = workspaceBootstrap(root, async () => {}, fakeGit);
  const publicSource = {
    repositoryUrl: "https://github.com/octo/repo.git",
    baseSha: "b".repeat(40),
  };
  await initialize(publicSource);
  const calls = (await readFile(log, "utf8")).trim().split("\n");
  assert.match(
    calls[0],
    /^clone --no-checkout --filter=blob:none -- https:\/\/github\.com\/octo\/repo\.git /,
  );
  assert.match(calls[1], new RegExp(`checkout --detach ${"b".repeat(40)}$`));
});
