import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDictation } from "./use-dictation";

type Instance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
};

/** A stand-in for the Web Speech API's constructor and its statics. */
function stubRecognition(availability?: string, installs = true) {
  const instances: Instance[] = [];
  class Recognition {
    static available = availability
      ? vi.fn(async () => availability)
      : undefined;
    static install = vi.fn(async () => installs);
    lang = "";
    continuous = false;
    interimResults = false;
    processLocally = false;
    onresult = null;
    onerror = null;
    onend = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    constructor() {
      instances.push(this as unknown as Instance);
    }
  }
  vi.stubGlobal("SpeechRecognition", Recognition);
  return { instances, Recognition };
}

function results(...entries: Array<[string, boolean]>) {
  return entries.map(([transcript, isFinal]) =>
    Object.assign([{ transcript }], { isFinal }),
  );
}

function setup() {
  const onFinal = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useDictation({ onFinal, onError }));
  return { ...hook, onFinal, onError };
}

describe("useDictation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      window.localStorage.clear();
    } catch {
      /* No storage in this runtime. */
    }
  });

  it("is unsupported without the Web Speech API", () => {
    const { result } = setup();
    expect(result.current.supported).toBe(false);
  });

  it("listens on the device and reports interim and final words", async () => {
    const { instances } = stubRecognition("available");
    const { result, onFinal } = setup();
    expect(result.current.supported).toBe(true);
    await act(() => result.current.start());
    expect(result.current.phase).toBe("listening");
    expect(result.current.mode).toBe("local");
    const recognition = instances[0]!;
    expect(recognition).toMatchObject({
      continuous: true,
      interimResults: true,
      processLocally: true,
    });
    expect(recognition.start).toHaveBeenCalled();
    act(() =>
      recognition.onresult?.({
        resultIndex: 0,
        results: results(["hello", true], [" wor", false]),
      }),
    );
    expect(onFinal).toHaveBeenCalledWith("hello");
    expect(result.current.interim).toBe(" wor");
  });

  it("downloads the on-device model first, and can be cancelled", async () => {
    const { Recognition, instances } = stubRecognition("downloadable");
    let finish!: (value: boolean) => void;
    Recognition.install.mockImplementation(
      () => new Promise<boolean>((resolve) => (finish = resolve)),
    );
    const { result } = setup();
    let starting!: Promise<void>;
    act(() => {
      starting = result.current.start();
    });
    await waitFor(() => expect(result.current.phase).toBe("installing"));
    act(() => result.current.stop());
    expect(result.current.phase).toBe("idle");
    await act(async () => {
      finish(true);
      await starting;
    });
    expect(instances).toHaveLength(0);
    expect(result.current.phase).toBe("idle");
  });

  it("asks once before sending audio to the browser's speech service", async () => {
    const { instances } = stubRecognition("unavailable");
    const { result } = setup();
    await act(() => result.current.start());
    expect(result.current.phase).toBe("consent");
    expect(instances).toHaveLength(0);
    act(() => result.current.declineConsent());
    expect(result.current.phase).toBe("idle");
    await act(() => result.current.start());
    act(() => result.current.acceptConsent());
    expect(result.current.phase).toBe("listening");
    expect(result.current.mode).toBe("cloud");
    expect(instances[0]!.processLocally).toBe(false);
  });

  it("maps recognition errors to what the member can do", async () => {
    const { instances } = stubRecognition("available");
    const { result, onError } = setup();
    await act(() => result.current.start());
    act(() => instances[0]!.onerror?.({ error: "not-allowed" }));
    expect(onError).toHaveBeenLastCalledWith(
      "Allow microphone access to use dictation.",
    );
    act(() => instances[0]!.onerror?.({ error: "service-not-allowed" }));
    expect(onError).toHaveBeenLastCalledWith(
      "Turn on Dictation in your system settings.",
    );
    act(() => instances[0]!.onerror?.({ error: "aborted" }));
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("stops gracefully, discards on request, and aborts on unmount", async () => {
    const { instances } = stubRecognition("available");
    const { result, unmount } = setup();
    await act(() => result.current.start());
    act(() => result.current.stop());
    expect(instances[0]!.stop).toHaveBeenCalled();
    await act(() => result.current.start());
    act(() => result.current.stop(true));
    expect(instances[1]!.abort).toHaveBeenCalled();
    await act(() => result.current.start());
    unmount();
    expect(instances[2]!.abort).toHaveBeenCalled();
  });

  it("returns to idle when the browser ends recognition", async () => {
    const { instances } = stubRecognition("available");
    const { result } = setup();
    await act(() => result.current.start());
    act(() => instances[0]!.onend?.());
    expect(result.current.phase).toBe("idle");
  });
});
