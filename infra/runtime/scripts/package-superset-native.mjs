import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

const [supersetRoot, stagingRoot] = process.argv.slice(2);
if (!supersetRoot || !stagingRoot) {
  throw new Error(
    "Usage: node package-superset-native.mjs <superset-root> <staging-root>",
  );
}
if (process.platform !== "linux") {
  throw new Error("Native modules must be packaged on Linux");
}

const searchRoots = [
  join(supersetRoot, "packages/host-service"),
  join(supersetRoot, "apps/desktop"),
  supersetRoot,
  // Bun materializes platform optional dependencies in this shared store,
  // without always linking them into an individual workspace package.
  join(supersetRoot, "node_modules/.bun"),
];
const copied = new Map();

function packageJsonPath(name, fromRoots) {
  for (const root of fromRoots) {
    const require = createRequire(join(root, "package.json"));
    try {
      return realpathSync(require.resolve(`${name}/package.json`));
    } catch {
      // Some packages do not export package.json. Resolve their entry point
      // and walk upward to the matching package root instead.
    }
    try {
      let directory = dirname(require.resolve(name));
      while (directory !== dirname(directory)) {
        const candidate = join(directory, "package.json");
        if (existsSync(candidate)) {
          const pkg = JSON.parse(readFileSync(candidate, "utf8"));
          if (pkg.name === name) return realpathSync(candidate);
        }
        directory = dirname(directory);
      }
    } catch {
      // Try the next installed workspace location.
    }
  }
  throw new Error(`Required installed package is missing: ${name}`);
}

function includePackage(name, fromRoots = searchRoots) {
  const manifestPath = packageJsonPath(name, fromRoots);
  const source = dirname(manifestPath);
  const previous = copied.get(name);
  if (previous) {
    if (previous !== source) {
      throw new Error(
        `Conflicting installed versions of ${name}: ${previous} and ${source}`,
      );
    }
    return;
  }

  const target = join(stagingRoot, "node_modules", ...name.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: (path) => path === source || basename(path) !== "node_modules",
  });
  copied.set(name, source);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    includePackage(dependency, [source, ...fromRoots]);
  }
}

includePackage("better-sqlite3");
includePackage("node-pty");
includePackage("@parcel/watcher");
// This CommonJS package is loaded through createRequire() at runtime, so
// Bun cannot fold it into the ESM host bundle.
includePackage("@xterm/headless");

// Parcel loads its platform-specific addon dynamically. Resolve it explicitly
// because optional dependencies are intentionally absent on other platforms.
const watcherArch =
  process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
if (!watcherArch) throw new Error(`Unsupported architecture: ${process.arch}`);
includePackage(`@parcel/watcher-linux-${watcherArch}-glibc`);

console.log(
  `Packaged ${copied.size} native runtime packages into ${resolve(stagingRoot)}`,
);
