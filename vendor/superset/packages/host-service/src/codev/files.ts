import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { FsHostService } from "@superset/workspace-fs/host";
import type { WorkspaceFilesystemManager } from "../runtime/filesystem";

/** The primary checkout is addressed explicitly until branch selection lands. */
export const CODEV_PRIMARY_WORKTREE_ID = "main";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LISTED_FILES = 5_000;
const HIDDEN_DIRECTORIES = new Set([".git", "node_modules", "target"]);

const worktreeIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
const pathSchema = z
	.string()
	.min(1)
	.max(4_096)
	.refine((value) => !value.startsWith("/") && !value.includes("\\"), {
		message: "Path must be relative to the selected worktree.",
	})
	.refine(
		(value) => value.split("/").every((part) => part !== "." && part !== ".."),
		{ message: "Path must not escape the selected worktree." },
	);

const listSchema = z.object({ worktreeId: worktreeIdSchema });
const readSchema = listSchema.extend({ path: pathSchema });
const saveSchema = readSchema.extend({
	contents: z.string().max(MAX_FILE_BYTES),
	expectedRevision: z.string().min(1).max(255),
});

type FileService = Pick<
	FsHostService,
	"getMetadata" | "listDirectory" | "readFile" | "watchPath" | "writeFile"
>;

export type CoDevExternalFileChange = {
	type: "file.changed";
	worktreeId: string;
	path: string;
	revision: string;
	origin: "external";
};

export type CoDevFileBridgeOptions = {
	app: Hono;
	filesystem: WorkspaceFilesystemManager;
	workspaceRoot: string;
	bridgeSecret: string;
};

function isWithin(rootPath: string, candidate: string) {
	const path = relative(rootPath, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

/**
 * Resolve a CoDev worktree name to one known location inside the mounted
 * workspace. The primary checkout is `main`; agent branches live in the same
 * directory that codev-guestd creates with `git worktree add`.
 */
export async function resolveCoDevWorktreeRoot(
	workspaceRoot: string,
	worktreeId: string,
) {
	const checkedId = worktreeIdSchema.parse(worktreeId);
	const root = await realpath(workspaceRoot);
	const requested =
		checkedId === CODEV_PRIMARY_WORKTREE_ID
			? root
			: resolve(root, ".git", "codev-agent-worktrees", checkedId);
	const resolved = await realpath(requested);
	if (!isWithin(root, resolved)) {
		throw new Error("Worktree path escapes the CoDev workspace.");
	}
	return resolved;
}

function requestSecretMatches(actual: string | undefined, expected: string) {
	if (!actual) return false;
	const actualBytes = Buffer.from(actual);
	const expectedBytes = Buffer.from(expected);
	return (
		actualBytes.length === expectedBytes.length &&
		timingSafeEqual(actualBytes, expectedBytes)
	);
}

function queryInput(request: Request, schema: typeof listSchema | typeof readSchema) {
	const query = new URL(request.url).searchParams;
	return schema.safeParse({
		worktreeId: query.get("worktreeId"),
		path: query.get("path"),
	});
}

function asRelativePath(root: string, absolutePath: string) {
	const path = relative(root, absolutePath).split(sep).join("/");
	return pathSchema.parse(path);
}

async function listFiles(service: FileService, root: string) {
	const files: Array<{ path: string; kind: "file"; size: number }> = [];
	const pending = [root];

	while (pending.length > 0) {
		const directory = pending.pop();
		if (!directory) break;
		const { entries } = await service.listDirectory({ absolutePath: directory });
		for (const entry of entries) {
			if (entry.kind === "directory") {
				if (!HIDDEN_DIRECTORIES.has(entry.name)) pending.push(entry.absolutePath);
				continue;
			}
			if (entry.kind !== "file") continue;
			const metadata = await service.getMetadata({
				absolutePath: entry.absolutePath,
			});
			if (!metadata || metadata.size === null) continue;
			files.push({
				path: asRelativePath(root, entry.absolutePath),
				kind: "file",
				size: metadata.size,
			});
			if (files.length > MAX_LISTED_FILES) {
				throw new Error("Workspace contains too many files to display.");
			}
		}
	}

	return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function readTextFile(service: FileService, root: string, path: string) {
	const result = await service.readFile({
		absolutePath: resolve(root, path),
		encoding: "utf-8",
		maxBytes: MAX_FILE_BYTES,
	});
	if (result.kind !== "text" || result.exceededLimit) {
		throw new Error("File exceeds the two MiB editor limit.");
	}
	return {
		path,
		kind: "file" as const,
		size: result.byteLength,
		contents: result.content,
		revision: result.revision,
	};
}

/**
 * A compact, per-worktree journal of writes that did not come through this
 * bridge. The authenticated CoDev gateway drains it; the browser never sees
 * the host watcher or its absolute paths.
 */
class ExternalChangeJournal {
	private readonly watches = new Map<string, Promise<void>>();
	private readonly changes = new Map<string, CoDevExternalFileChange[]>();
	private readonly ownWrites = new Set<string>();

	constructor(
		private readonly filesystem: WorkspaceFilesystemManager,
		private readonly workspaceRoot: string,
	) {}

	async start(worktreeId: string) {
		if (this.watches.has(worktreeId)) return;
		const root = await resolveCoDevWorktreeRoot(this.workspaceRoot, worktreeId);
		const service = this.filesystem.getServiceForRootPath(root);
		const watch = this.consume(worktreeId, root, service).catch((error) => {
			console.error("[codev-file-bridge] external file watch failed", {
				worktreeId,
				error,
			});
			this.watches.delete(worktreeId);
		});
		this.watches.set(worktreeId, watch);
	}

	markOwnWrite(worktreeId: string, path: string, revision: string) {
		this.ownWrites.add(`${worktreeId}\0${path}\0${revision}`);
	}

	drain(worktreeId: string) {
		const changes = this.changes.get(worktreeId) ?? [];
		this.changes.delete(worktreeId);
		return changes;
	}

	private async consume(worktreeId: string, root: string, service: FileService) {
		const stream = service.watchPath({ absolutePath: root });
		for await (const batch of stream) {
			for (const event of batch.events) {
				if (event.isDirectory || !isWithin(root, event.absolutePath)) continue;
				const metadata = await service.getMetadata({
					absolutePath: event.absolutePath,
				});
				if (!metadata || metadata.kind !== "file") continue;
				const path = asRelativePath(root, event.absolutePath);
				const ownWriteKey = `${worktreeId}\0${path}\0${metadata.revision}`;
				if (this.ownWrites.delete(ownWriteKey)) continue;
				const pending = this.changes.get(worktreeId) ?? [];
				const prior = pending.findIndex((change) => change.path === path);
				const change: CoDevExternalFileChange = {
					type: "file.changed",
					worktreeId,
					path,
					revision: metadata.revision,
					origin: "external",
				};
				if (prior >= 0) pending[prior] = change;
				else pending.push(change);
				this.changes.set(worktreeId, pending);
			}
		}
	}
}

/**
 * Internal-only endpoints for codev-guestd. These never receive a browser
 * cookie: the guest must present its boot-time bridge secret, and the host
 * still confines every operation to a CoDev-selected worktree.
 */
export function registerCoDevFileBridge({
	app,
	filesystem,
	workspaceRoot,
	bridgeSecret,
}: CoDevFileBridgeOptions) {
	const requireBridge = (request: Request) =>
		requestSecretMatches(request.headers.get("x-codev-bridge-secret") ?? undefined, bridgeSecret);
	const changes = new ExternalChangeJournal(filesystem, workspaceRoot);

	app.get("/codev/files", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = queryInput(context.req.raw, listSchema);
		if (!parsed.success) return context.json({ error: "Invalid file list request." }, 400);
		try {
			const root = await resolveCoDevWorktreeRoot(workspaceRoot, parsed.data.worktreeId);
			await changes.start(parsed.data.worktreeId);
			return context.json({ files: await listFiles(filesystem.getServiceForRootPath(root), root) });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not list files." }, 400);
		}
	});

	app.get("/codev/file", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = queryInput(context.req.raw, readSchema);
		if (!parsed.success) return context.json({ error: "Invalid file read request." }, 400);
		try {
			const root = await resolveCoDevWorktreeRoot(workspaceRoot, parsed.data.worktreeId);
			await changes.start(parsed.data.worktreeId);
			return context.json({ file: await readTextFile(filesystem.getServiceForRootPath(root), root, parsed.data.path) });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not read file." }, 400);
		}
	});

	app.put("/codev/file", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = saveSchema.safeParse(await context.req.json().catch(() => undefined));
		if (!parsed.success) return context.json({ error: "Invalid file save request." }, 400);
		try {
			const root = await resolveCoDevWorktreeRoot(workspaceRoot, parsed.data.worktreeId);
			await changes.start(parsed.data.worktreeId);
			const service = filesystem.getServiceForRootPath(root);
			const result = await service.writeFile({
				absolutePath: resolve(root, parsed.data.path),
				content: parsed.data.contents,
				encoding: "utf-8",
				options: { create: false, overwrite: true },
				precondition: { ifMatch: parsed.data.expectedRevision },
			});
			if (!result.ok) {
				return context.json(
					{
						error: "This file changed on the machine since you opened it.",
						currentRevision:
							result.reason === "conflict"
								? result.currentRevision
								: "missing",
					},
					409,
				);
			}
			changes.markOwnWrite(
				parsed.data.worktreeId,
				parsed.data.path,
				result.revision,
			);
			return context.json({ file: await readTextFile(service, root, parsed.data.path) });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not save file." }, 400);
		}
	});

	app.get("/codev/file/changes", async (context) => {
		if (!requireBridge(context.req.raw)) return context.json({ error: "Unauthorized" }, 401);
		const parsed = queryInput(context.req.raw, listSchema);
		if (!parsed.success) return context.json({ error: "Invalid file change request." }, 400);
		try {
			await changes.start(parsed.data.worktreeId);
			return context.json({ changes: changes.drain(parsed.data.worktreeId) });
		} catch (error) {
			return context.json({ error: error instanceof Error ? error.message : "Could not read file changes." }, 400);
		}
	});
}
