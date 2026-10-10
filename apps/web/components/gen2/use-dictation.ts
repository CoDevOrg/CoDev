"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & {
  isFinal: boolean;
};
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<RecognitionResult>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type LanguageOptions = { langs: string[]; processLocally: boolean };
type RecognitionConstructor = {
  new (): Recognition;
  available?: (options: LanguageOptions) => Promise<string>;
  install?: (options: LanguageOptions) => Promise<boolean>;
};

export type DictationPhase =
  | "idle"
  | "checking"
  | "consent"
  | "installing"
  | "listening";

const CONSENT_KEY = "codev-gen2-dictation-cloud";

const ERRORS: Record<string, string> = {
  "not-allowed": "Allow microphone access to use dictation.",
  "service-not-allowed": "Turn on Dictation in your system settings.",
  "audio-capture": "No microphone is available for dictation.",
  network: "Dictation couldn’t reach the speech service.",
  "language-not-supported": "Dictation doesn’t support this language yet.",
};

function recognitionConstructor() {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const noSubscription = () => () => {};

function storedConsent() {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

/** "local" when the browser can recognize speech on this device. */
async function localMode(
  Recognizer: RecognitionConstructor,
  options: LanguageOptions,
): Promise<"local" | "install" | "cloud"> {
  if (!Recognizer.available) return "cloud";
  const status = await Recognizer.available(options).catch(() => "unavailable");
  if (status === "available") return "local";
  return status === "downloadable" || status === "downloading"
    ? "install"
    : "cloud";
}

/**
 * Dictation through the Web Speech API. It prefers on-device recognition,
 * downloading the language model when the browser offers one; sending audio
 * to the browser's speech service needs the member's one-time consent.
 * Final phrases go to `onFinal`; interim text is shown while listening.
 */
export function useDictation({
  onFinal,
  onError,
}: {
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}) {
  const supported = useSyncExternalStore(
    noSubscription,
    () => recognitionConstructor() !== null,
    () => false,
  );
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [interim, setInterim] = useState("");
  const [mode, setMode] = useState<"local" | "cloud" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recognitionRef = useRef<Recognition | null>(null);
  const runRef = useRef(0);
  const handlers = useRef({ onFinal, onError });
  useEffect(() => {
    handlers.current = { onFinal, onError };
  });

  useEffect(() => {
    if (phase !== "listening") return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      runRef.current += 1;
      recognitionRef.current?.abort();
    },
    [],
  );

  function listen(local: boolean) {
    const Recognizer = recognitionConstructor();
    if (!Recognizer) return;
    const recognition = new Recognizer();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    if (local) recognition.processLocally = true;
    recognition.onresult = (event) => {
      let pending = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index]!;
        const text = result[0]?.transcript ?? "";
        if (!result.isFinal) pending += text;
        else if (text.trim()) handlers.current.onFinal(text.trim());
      }
      setInterim(pending);
    };
    recognition.onerror = (event) => {
      const message = ERRORS[event.error];
      if (message) handlers.current.onError(message);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setPhase("idle");
      setInterim("");
    };
    recognitionRef.current = recognition;
    setMode(local ? "local" : "cloud");
    setElapsed(0);
    setPhase("listening");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setPhase("idle");
      handlers.current.onError("Dictation couldn’t start. Try again.");
    }
  }

  async function start() {
    const Recognizer = recognitionConstructor();
    if (!Recognizer || phase !== "idle") return;
    const run = (runRef.current += 1);
    const options = {
      langs: [navigator.language || "en-US"],
      processLocally: true,
    };
    setPhase("checking");
    let local = await localMode(Recognizer, options);
    if (local === "install" && runRef.current === run) {
      setPhase("installing");
      const installed = await Recognizer.install?.(options).catch(() => false);
      local = installed ? "local" : "cloud";
    }
    if (runRef.current !== run) return;
    if (local === "cloud" && !storedConsent()) return setPhase("consent");
    listen(local === "local");
  }

  /** Ends listening; with `discard`, phrases still in flight are dropped. */
  function stop(discard = false) {
    runRef.current += 1;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (discard) recognition?.abort();
    else recognition?.stop();
    setPhase("idle");
    setInterim("");
  }

  function acceptConsent() {
    try {
      window.localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      /* The choice lasts this session only. */
    }
    listen(false);
  }

  return {
    supported,
    phase,
    interim,
    mode,
    elapsed,
    start,
    stop,
    acceptConsent,
    declineConsent: () => setPhase("idle"),
  };
}

export type Dictation = ReturnType<typeof useDictation>;
