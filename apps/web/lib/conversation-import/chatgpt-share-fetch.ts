import "server-only";

import type { ImportedConversation } from "@codev/contracts";

import { importChatGptShareHtml } from "./chatgpt-share";
import {
  ChatGptShareParseError,
  parseChatGptShareUrl,
} from "./chatgpt-share-parser";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 2;

export type ChatGptShareFetchErrorCode =
  | "invalid_url"
  | "unavailable"
  | "upstream_error"
  | "timed_out"
  | "invalid_content_type"
  | "response_too_large"
  | "invalid_conversation";

export class ChatGptShareFetchError extends Error {
  constructor(
    readonly code: ChatGptShareFetchErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ChatGptShareFetchError";
  }
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type PreviewChatGptShareOptions = {
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

function validatedShareUrl(sourceUrl: string) {
  try {
    return parseChatGptShareUrl(sourceUrl);
  } catch (error) {
    if (error instanceof ChatGptShareParseError) {
      throw new ChatGptShareFetchError("invalid_url", error.message);
    }
    throw error;
  }
}

function positiveLimit(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

async function readLimitedText(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ChatGptShareFetchError(
      "response_too_large",
      "The ChatGPT share page is too large to import.",
      response.status,
    );
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new ChatGptShareFetchError(
          "response_too_large",
          "The ChatGPT share page is too large to import.",
          response.status,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

export async function previewChatGptShare(
  sourceUrl: string,
  options: PreviewChatGptShareOptions = {},
): Promise<ImportedConversation> {
  const initial = validatedShareUrl(sourceUrl);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = positiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxResponseBytes = positiveLimit(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
  );
  const signal = AbortSignal.timeout(timeoutMs);
  let currentUrl = initial.url;
  let response: Response | undefined;

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      response = await fetchImplementation(currentUrl, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "CoDev-Conversation-Importer/1.0",
        },
        signal,
      });

      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) {
        throw new ChatGptShareFetchError(
          "upstream_error",
          "ChatGPT returned too many redirects.",
          response.status,
        );
      }

      const redirected = validatedShareUrl(
        new URL(location, currentUrl).toString(),
      );
      if (redirected.shareId !== initial.shareId) {
        throw new ChatGptShareFetchError(
          "invalid_url",
          "ChatGPT redirected to a different shared conversation.",
          response.status,
        );
      }
      currentUrl = redirected.url;
    }
  } catch (error) {
    if (error instanceof ChatGptShareFetchError) throw error;
    if (isTimeoutError(error)) {
      throw new ChatGptShareFetchError(
        "timed_out",
        "ChatGPT did not respond before the import timed out.",
      );
    }
    throw new ChatGptShareFetchError(
      "upstream_error",
      "The ChatGPT share page could not be fetched.",
    );
  }

  if (!response) {
    throw new ChatGptShareFetchError(
      "upstream_error",
      "The ChatGPT share page could not be fetched.",
    );
  }
  if (response.status === 404 || response.status === 410) {
    throw new ChatGptShareFetchError(
      "unavailable",
      "The ChatGPT shared conversation is no longer available.",
      response.status,
    );
  }
  if (!response.ok) {
    throw new ChatGptShareFetchError(
      "upstream_error",
      "ChatGPT returned an unexpected response.",
      response.status,
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (!contentType?.includes("text/html")) {
    throw new ChatGptShareFetchError(
      "invalid_content_type",
      "ChatGPT returned content that is not an HTML share page.",
      response.status,
    );
  }

  const html = await readLimitedText(response, maxResponseBytes);
  try {
    return importChatGptShareHtml(html, sourceUrl);
  } catch (error) {
    if (error instanceof ChatGptShareParseError) {
      throw new ChatGptShareFetchError(
        error.code === "unavailable" ? "unavailable" : "invalid_conversation",
        error.message,
        response.status,
      );
    }
    throw error;
  }
}
