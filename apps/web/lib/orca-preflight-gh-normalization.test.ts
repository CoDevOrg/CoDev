import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * The CoDev preload script that boots ahead of the vendored Orca bundle.
 * Both copies must stay in sync: the one served with the web client and the
 * one baked into the Orca host image.
 */
const preloadPaths = [
  "public/orca/codev-preload.js",
  "../../infra/aws/orca-build/codev-preload.js",
];

type PreflightStatus = {
  git?: { installed?: boolean };
  gh?: { installed?: boolean; authenticated?: boolean };
};

function loadPreload(path: string) {
  const descriptors: Record<string, PropertyDescriptor> = {};
  const window = {
    localStorage: {
      getItem: () => "{}",
      setItem: () => {},
    },
    Object,
    Promise,
  };
  // The preload defines `window.api` as an accessor; capture it so the test
  // can assign a fake host bridge and observe what the setter rewrites.
  const windowProxy = new Proxy(window as Record<string, unknown>, {
    defineProperty(target, prop, descriptor) {
      descriptors[String(prop)] = descriptor;
      return Reflect.defineProperty(target, prop, descriptor);
    },
  });
  runInNewContext(readFileSync(path, "utf8"), { window: windowProxy });
  return {
    setApi: (value: unknown) => {
      descriptors.api?.set?.call(windowProxy, value);
    },
    getApi: () => descriptors.api?.get?.call(windowProxy),
  };
}

describe.each(preloadPaths)("gh preflight normalization in %s", (path) => {
  it("reports the sandboxed gh CLI as installed and authenticated", async () => {
    const { setApi, getApi } = loadPreload(path);
    const raw: PreflightStatus = {
      git: { installed: true },
      gh: { installed: false, authenticated: false },
    };
    setApi({ preflight: { check: () => Promise.resolve(raw) } });

    const status = (await (
      getApi() as { preflight: { check: () => Promise<PreflightStatus> } }
    ).preflight.check()) as PreflightStatus;

    expect(status.gh).toEqual({ installed: true, authenticated: true });
    // Unrelated preflight fields pass through untouched.
    expect(status.git).toEqual({ installed: true });
  });

  it("does not double-wrap preflight.check across repeated api assignments", async () => {
    const { setApi, getApi } = loadPreload(path);
    let calls = 0;
    const api = {
      preflight: {
        check: () => {
          calls += 1;
          return Promise.resolve({ gh: { installed: false } });
        },
      },
    };
    setApi(api);
    const wrapped = (getApi() as typeof api).preflight.check;
    setApi(api);
    expect((getApi() as typeof api).preflight.check).toBe(wrapped);

    await (getApi() as typeof api).preflight.check();
    expect(calls).toBe(1);
  });

  it("tolerates a preflight result with no gh field", async () => {
    const { setApi, getApi } = loadPreload(path);
    setApi({ preflight: { check: () => Promise.resolve({ git: {} }) } });
    const status = await (
      getApi() as { preflight: { check: () => Promise<PreflightStatus> } }
    ).preflight.check();
    expect(status).toEqual({ git: {} });
  });
});
