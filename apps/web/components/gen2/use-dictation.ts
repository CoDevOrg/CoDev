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

type RecognitionEvents = {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (error: string) => void;
  onEnd: (recognition: Recognition) => void;
};

/** A continuous recognizer in the page's language, wired to `events`. */
function createRecognition(
  Recognizer: RecognitionConstructor,
  local: boolean,
  events: RecognitionEvents,
) {
  const recognition = new Recognizer();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  if (local) recognition.processLocally = true;
  recognition.onresult = (event) => {
    const results = Array.from(event.results).slice(event.resultIndex);
    const text = (final: boolean) =>
      results
        .filter((result) => result.isFinal === final)
        .map((result) => result[0]?.transcript ?? "")
        .join(final ? " " : "");
    // One call per event, so phrases that land together insert together.
    const heard = text(true).replace(/\s+/g, " ").trim();
    if (heard) events.onFinal(heard);
    events.onInterim(text(false));
  };
  recognition.onerror = (event) => events.onError(event.error);
  recognition.onend = () => events.onEnd(recognition);
  return recognition;
}

/** Whole seconds since `active` last turned on; 0 while it is off. */
function useElapsed(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const [was, setWas] = useState(active);
  if (was !== active) {
    setWas(active);
    setElapsed(0);
  }
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [active]);
  return elapsed;
}

/** Whether to recognize on this device, downloading its model if needed. */
async function chooseMode(
  Recognizer: RecognitionConstructor,
  onInstalling: () => void,
  current: () => boolean,
) {
  const options = {
    langs: [navigator.language || "en-US"],
    processLocally: true,
  };
  const mode = await localMode(Recognizer, options);
  if (mode !== "install" || !current()) return mode;
  onInstalling();
  const installed = await Recognizer.install?.(options).catch(() => false);
  return installed ? "local" : "cloud";
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
  const elapsed = useElapsed(phase === "listening");
  const recognitionRef = useRef<Recognition | null>(null);
  const runRef = useRef(0);
  const handlers = useRef({ onFinal, onError });
  useEffect(() => {
    handlers.current = { onFinal, onError };
  });
  useEffect(
    () => () => {
      runRef.current += 1;
      recognitionRef.current?.abort();
    },
    [],
  );

  const events: RecognitionEvents = {
    onFinal: (text) => handlers.current.onFinal(text),
    onInterim: setInterim,
    onError: (error) => {
      const message = ERRORS[error];
      if (message) handlers.current.onError(message);
    },
    onEnd: (recognition) => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setPhase("idle");
      setInterim("");
    },
  };

  function listen(local: boolean) {
    const Recognizer = recognitionConstructor();
    if (!Recognizer) return;
    const recognition = createRecognition(Recognizer, local, events);
    recognitionRef.current = recognition;
    setMode(local ? "local" : "cloud");
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
    const current = () => runRef.current === run;
    setPhase("checking");
    const local = await chooseMode(
      Recognizer,
      () => setPhase("installing"),
      current,
    );
    if (!current()) return;
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
