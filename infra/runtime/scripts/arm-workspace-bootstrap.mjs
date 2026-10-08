import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  lstat,
  symlink,
  rm,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";

const execute = promisify(execFile);
const git = (root, executable, ...args) =>
  execute(executable, ["-c", `safe.directory=${root}`, "-C", root, ...args], {
    timeout: 55_000,
    maxBuffer: 1 << 20,
    env: {
      PATH: "/usr/bin:/bin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
const exists = async (path) =>
  lstat(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

function validateSource(input) {
  if (!/^[a-f0-9]{40}$/.test(input.baseSha)) throw new Error("INVALID_SOURCE");
  if (
    input.repositoryUrl !== null &&
    !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(input.repositoryUrl)
  )
    throw new Error("INVALID_SOURCE");
  return JSON.stringify({
    repositoryUrl: input.repositoryUrl,
    baseSha: input.baseSha,
  });
}

async function prepare(stage, source, input, executable) {
  await mkdir(stage, { recursive: true, mode: 0o700 });
  const sourcePath = join(stage, "source.json");
  if (await exists(sourcePath)) {
    if ((await readFile(sourcePath, "utf8")) !== source)
      throw new Error("SOURCE_MISMATCH");
    return;
  }
  const checkout = join(stage, "checkout");
  // Only controller-owned staging is disposable; never delete saved workspace files.
  await rm(checkout, { recursive: true, force: true });
  if (input.repositoryUrl) {
    // Blobless: full commit history, but only the base commit's file contents.
    // Older blobs are fetched on demand from the public remote.
    await execute(
      executable,
      [
        "clone",
        "--no-checkout",
        "--filter=blob:none",
        "--",
        input.repositoryUrl,
        checkout,
      ],
      {
        timeout: 55_000,
        maxBuffer: 1 << 20,
        env: {
          PATH: "/usr/bin:/bin",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
    await git(checkout, executable, "checkout", "--detach", input.baseSha);
  } else {
    await mkdir(checkout, { recursive: true, mode: 0o775 });
    await git(checkout, executable, "init", "--initial-branch=main");
  }
  await writeFile(sourcePath, source, { mode: 0o600 });
}

async function stageFile(checkout, file) {
  const parts = typeof file.path === "string" ? file.path.split("/") : [];
  if (
    !parts.length ||
    parts.some(
      (part) => !part || [".", "..", ".git", ".codev-runtime"].includes(part),
    ) ||
    /[\\\0]/.test(file.path)
  )
    throw new Error("INVALID_PATH");
  if (
    !["100644", "100755", "120000"].includes(file.mode) ||
    typeof file.contentBase64 !== "string"
  )
    throw new Error("INVALID_FILE");
  let parent = checkout;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    await mkdir(parent, { recursive: true });
    if (!(await lstat(parent)).isDirectory()) throw new Error("INVALID_PATH");
  }
  const path = join(checkout, ...parts);
  const contents = Buffer.from(file.contentBase64, "base64");
  if (file.mode === "120000") {
    if (await exists(path)) {
      const info = await lstat(path);
      if (!info.isSymbolicLink()) throw new Error("INVALID_PATH");
      await rm(path);
    }
    await symlink(contents.toString("utf8"), path);
    return;
  }
  if ((await exists(path)) && !(await lstat(path)).isFile())
    throw new Error("INVALID_PATH");
  await writeFile(path, contents, {
    mode: file.mode === "100755" ? 0o775 : 0o664,
  });
  await chmod(path, file.mode === "100755" ? 0o775 : 0o664);
}

async function finish(
  root,
  stage,
  source,
  repositoryUrl,
  ownership,
  executable,
) {
  const checkout = join(stage, "checkout");
  const publishing = join(stage, "publishing");
  if (!(await exists(publishing))) {
    if (!repositoryUrl) {
      await git(checkout, executable, "add", "--all");
      await git(
        checkout,
        executable,
        "-c",
        "user.name=CoDev",
        "-c",
        "user.email=workspace@codev.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "Workspace snapshot",
      );
    }
    const entries = await readdir(checkout);
    for (const entry of entries) {
      if (await exists(join(root, entry)))
        throw new Error("SAVED_CHECKOUT_CONFLICT");
    }
    await ownership(checkout);
    await writeFile(publishing, JSON.stringify(entries), { mode: 0o600 });
  }
  const entries = JSON.parse(await readFile(publishing, "utf8"));
  for (const entry of entries) {
    if (await exists(join(checkout, entry)))
      await rename(join(checkout, entry), join(root, entry));
    else if (!(await exists(join(root, entry))))
      throw new Error("SAVED_CHECKOUT_MISSING");
  }
  await writeFile(join(stage, "complete"), source, { mode: 0o600 });
  return { initialized: true };
}

/** Serialized and resumable initialization, authorized only by the new-disk marker. */
export function workspaceBootstrap(
  root = "/workspace",
  ownership = (checkout) =>
    execute("/usr/bin/chown", ["-hR", "codev-shell:codev-shell", checkout], {
      timeout: 10_000,
    }),
  executable = "/usr/bin/git",
) {
  let pending = Promise.resolve();
  return (input) => {
    const result = pending.then(async () => {
      const source = validateSource(input);
      const stage = join(root, ".codev-runtime", "bootstrap");
      const complete = join(stage, "complete");
      if (await exists(complete)) {
        if ((await readFile(complete, "utf8")) !== source)
          throw new Error("SOURCE_MISMATCH");
        return { initialized: true };
      }
      if (!(await exists(join(stage, "new-disk")))) {
        // Older canaries and migrated disks must already carry their checkout.
        if (await exists(join(root, ".git"))) return { initialized: true };
        throw new Error("SAVED_CHECKOUT_MISSING");
      }
      await prepare(stage, source, input, executable);
      if (input.file) {
        if (input.repositoryUrl !== null) throw new Error("INVALID_SOURCE");
        await stageFile(join(stage, "checkout"), input.file);
      }
      return input.complete
        ? finish(
            root,
            stage,
            source,
            input.repositoryUrl,
            ownership,
            executable,
          )
        : { initialized: false };
    });
    pending = result.catch(() => {});
    return result;
  };
}
