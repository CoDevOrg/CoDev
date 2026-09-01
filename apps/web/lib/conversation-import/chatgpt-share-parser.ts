type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type ParsedChatGptAsset = {
  kind: "image" | "file";
  sourceUrl: string;
  filename: string;
  description: string | null;
  downloadable: boolean;
};

export type ParsedChatGptMessage = {
  role: "user" | "assistant" | "system" | "tool";
  authorName: string;
  text: string;
  contentType: string | null;
  createdAt: string | null;
  artifacts: ParsedChatGptAsset[];
};

export type ParsedChatGptShare = {
  shareId: string;
  title: string;
  model: string | null;
  updatedAt: string | null;
  messages: ParsedChatGptMessage[];
  warnings: string[];
};

export type ChatGptParseOptions = {
  includeReasoning?: boolean;
  includeSystem?: boolean;
  includeToolOutput?: boolean;
};

export type ChatGptShareParseErrorCode = "invalid_page" | "unavailable";

export class ChatGptShareParseError extends Error {
  constructor(
    message: string,
    readonly code: ChatGptShareParseErrorCode = "invalid_page",
  ) {
    super(message);
    this.name = "ChatGptShareParseError";
  }
}

const SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const FLIGHT_MARKER = "streamController.enqueue(";

function isRecord(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): Json | undefined {
  try {
    return JSON.parse(value) as Json;
  } catch {
    return undefined;
  }
}

function timestampToIso(value: Json | undefined) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value < 1_000_000_000_000 ? value * 1_000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractScripts(html: string) {
  const scripts: Array<{ attributes: Record<string, string>; text: string }> =
    [];
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    const attributes: Record<string, string> = {};
    for (const attribute of (match[1] ?? "").matchAll(ATTRIBUTE_PATTERN)) {
      attributes[attribute[1].toLowerCase()] =
        attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    }
    scripts.push({ attributes, text: match[2] ?? "" });
  }
  return scripts;
}

function readJsonString(text: string, start: number) {
  if (text[start] !== '"') return null;
  for (let end = start + 1; end < text.length; end += 1) {
    if (text[end] !== '"') continue;
    let slashCount = 0;
    for (
      let index = end - 1;
      index >= start && text[index] === "\\";
      index -= 1
    ) {
      slashCount += 1;
    }
    if (slashCount % 2 !== 0) continue;
    const parsed = parseJson(text.slice(start, end + 1));
    return typeof parsed === "string" ? { value: parsed, end: end + 1 } : null;
  }
  return null;
}

function extractFlightPool(html: string): Json[] | null {
  for (const script of extractScripts(html)) {
    let cursor = 0;
    while (script.text.includes(FLIGHT_MARKER, cursor)) {
      const anchor = script.text.indexOf(FLIGHT_MARKER, cursor);
      const argumentStart = anchor + FLIGHT_MARKER.length;
      const quoteStart = script.text.indexOf('"', argumentStart);

      let candidate: string | null = null;
      if (quoteStart !== -1) {
        const decoded = readJsonString(script.text, quoteStart);
        if (decoded) {
          candidate = decoded.value;
          cursor = decoded.end;
        }
      } else {
        const close = script.text.indexOf(");", argumentStart);
        if (close === -1) break;
        candidate = script.text.slice(argumentStart, close).trim();
        cursor = close + 2;
      }

      const trimmedCandidate = candidate?.trim();
      if (trimmedCandidate?.startsWith("[") && trimmedCandidate.endsWith("]")) {
        const parsed = parseJson(trimmedCandidate);
        if (Array.isArray(parsed)) return parsed;
      }
      cursor = Math.max(cursor, argumentStart + 1);
    }
  }
  return null;
}

function decodeFlightPool(pool: Json[]) {
  const cache = new Map<number, Json>();

  const resolve = (value: Json): Json => {
    if (typeof value === "number" && Number.isInteger(value)) {
      if (value < 0 || value >= pool.length) return value;
      if (cache.has(value)) return cache.get(value) ?? null;
      cache.set(value, null);
      const decoded = resolve(pool[value]);
      cache.set(value, decoded);
      return decoded;
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (!isRecord(value)) return value;

    const decoded: Record<string, Json> = {};
    for (const [rawKey, item] of Object.entries(value)) {
      let key = rawKey;
      if (/^_\d+$/.test(rawKey)) {
        const referencedKey = pool[Number(rawKey.slice(1))];
        if (typeof referencedKey === "string") key = referencedKey;
      }
      decoded[key] = resolve(item);
    }
    return decoded;
  };

  const decoded: Record<string, Json> = {};
  for (let index = 1; index + 1 < pool.length; index += 2) {
    const key = pool[index];
    if (typeof key === "string" && !(key in decoded)) {
      decoded[key] = resolve(pool[index + 1]);
    }
  }
  return decoded;
}

function findObjects(
  root: Json,
  predicate: (value: Record<string, Json>) => boolean,
  limit = 10,
) {
  const found: Array<Record<string, Json>> = [];
  const seen = new Set<object>();

  const visit = (value: Json) => {
    if (found.length >= limit || value === null || typeof value !== "object")
      return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (predicate(value)) found.push(value);
    Object.values(value).forEach(visit);
  };

  visit(root);
  return found;
}

function looksLikeConversation(value: Record<string, Json>) {
  return Array.isArray(value.linear_conversation) || isRecord(value.mapping);
}

function filenameFor(
  messageId: string | null,
  index: number,
  mimeType: string | null,
) {
  const base = messageId?.split("-")[0] || "asset";
  const extension = mimeType?.includes("/") ? mimeType.split("/").at(-1) : null;
  return `${base}-${index}.${extension || "bin"}`;
}

function addArtifact(
  artifacts: ParsedChatGptAsset[],
  artifact: ParsedChatGptAsset,
) {
  if (
    !artifacts.some((existing) => existing.sourceUrl === artifact.sourceUrl)
  ) {
    artifacts.push(artifact);
  }
}

function flattenContent(
  message: Record<string, Json>,
  options: Required<ChatGptParseOptions>,
) {
  const content = isRecord(message.content) ? message.content : {};
  const contentType =
    typeof content.content_type === "string" ? content.content_type : null;
  const artifacts: ParsedChatGptAsset[] = [];
  const messageId = typeof message.id === "string" ? message.id : null;

  if (
    contentType === "model_editable_context" ||
    (!options.includeReasoning &&
      (contentType === "thoughts" || contentType === "reasoning_recap")) ||
    (!options.includeToolOutput &&
      (contentType === "tool_response" || contentType === "execution_output"))
  ) {
    return { text: "", contentType, artifacts };
  }

  const partsToText = (parts: Json | undefined) => {
    if (!Array.isArray(parts)) return "";
    const text: string[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        text.push(part);
        continue;
      }
      if (!isRecord(part)) continue;
      const partType =
        typeof (part.content_type ?? part.type) === "string"
          ? String(part.content_type ?? part.type)
          : null;
      if (partType === "image_asset_pointer" || partType === "image") {
        const pointer =
          typeof part.asset_pointer === "string"
            ? part.asset_pointer
            : typeof part.url === "string"
              ? part.url
              : null;
        if (pointer) {
          addArtifact(artifacts, {
            kind: "image",
            sourceUrl: pointer,
            filename: filenameFor(
              messageId,
              artifacts.length,
              typeof part.mime_type === "string" ? part.mime_type : null,
            ),
            description: null,
            downloadable: /^https?:\/\//i.test(pointer),
          });
          text.push("[image]");
        }
      } else if (typeof part.text === "string") {
        text.push(part.text);
      }
    }
    return text.join("\n\n").trim();
  };

  let text = "";
  if (contentType === "code") {
    const language =
      typeof content.language === "string" && content.language !== "unknown"
        ? content.language
        : "";
    const body = typeof content.text === "string" ? content.text : "";
    text = body ? `${"`".repeat(3)}${language}\n${body}\n${"`".repeat(3)}` : "";
  } else if (contentType === "thoughts" && Array.isArray(content.thoughts)) {
    text = content.thoughts
      .filter(isRecord)
      .map((thought) => {
        const summary =
          typeof thought.summary === "string" ? thought.summary : "";
        const body = typeof thought.content === "string" ? thought.content : "";
        return summary ? `**${summary}**\n\n${body}` : body;
      })
      .filter(Boolean)
      .join("\n\n");
  } else if (
    contentType === "tool_response" ||
    contentType === "execution_output"
  ) {
    text =
      typeof content.text === "string"
        ? content.text
        : typeof content.output === "string"
          ? content.output
          : "";
  } else {
    text =
      typeof content.text === "string"
        ? content.text
        : partsToText(content.parts);
  }

  const metadata = isRecord(message.metadata) ? message.metadata : {};
  if (Array.isArray(metadata.attachments)) {
    for (const attachment of metadata.attachments) {
      if (!isRecord(attachment)) continue;
      const url =
        typeof attachment.download_url === "string"
          ? attachment.download_url
          : typeof attachment.file_url === "string"
            ? attachment.file_url
            : null;
      if (!url) continue;
      const mimeType =
        typeof attachment.mime_type === "string" ? attachment.mime_type : null;
      const name = typeof attachment.name === "string" ? attachment.name : null;
      const rawType =
        typeof (attachment.file_type ?? attachment.type) === "string"
          ? String(attachment.file_type ?? attachment.type)
          : "file";
      addArtifact(artifacts, {
        kind: rawType.toLowerCase().includes("image") ? "image" : "file",
        sourceUrl: url,
        filename: name ?? filenameFor(messageId, artifacts.length, mimeType),
        description:
          typeof attachment.title === "string" ? attachment.title : name,
        downloadable: /^https?:\/\//i.test(url),
      });
    }
  }

  return { text: text.trim(), contentType, artifacts };
}

function roleFor(value: Json | undefined) {
  return value === "user" ||
    value === "assistant" ||
    value === "system" ||
    value === "tool"
    ? value
    : "assistant";
}

function authorNameFor(
  author: Record<string, Json>,
  role: ParsedChatGptMessage["role"],
) {
  if (typeof author.name === "string" && author.name.trim())
    return author.name.trim();
  return role === "user"
    ? "User"
    : role === "tool"
      ? "Tool"
      : role === "system"
        ? "System"
        : "Assistant";
}

function isNonTranscriptPlaceholder(
  role: ParsedChatGptMessage["role"],
  text: string,
) {
  const normalized = text.trim().toLowerCase();
  return (
    (role === "user" &&
      normalized === "original custom instructions no longer available") ||
    (role === "tool" &&
      normalized === "the output of this plugin was redacted.")
  );
}

function walkMapping(mapping: Record<string, Json>) {
  const rootId = Object.keys(mapping).find((id) => {
    const node = mapping[id];
    return (
      isRecord(node) && (node.parent === null || node.parent === undefined)
    );
  });
  if (!rootId) return Object.values(mapping);

  const ordered: Json[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = rootId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node: Json = mapping[currentId];
    if (!isRecord(node)) break;
    ordered.push(node);
    const children: Json = node.children;
    const nextChild: Json | undefined = Array.isArray(children)
      ? children.at(-1)
      : undefined;
    currentId = typeof nextChild === "string" ? nextChild : undefined;
  }
  return ordered;
}

function buildMessages(
  data: Record<string, Json>,
  options: Required<ChatGptParseOptions>,
  warnings: string[],
) {
  const mapping = isRecord(data.mapping) ? data.mapping : {};
  const linear = Array.isArray(data.linear_conversation)
    ? data.linear_conversation
    : [];
  let nodes: Json[];
  if (linear.length > 0) {
    nodes = linear.map((entry) => {
      if (!isRecord(entry)) return null;
      if (isRecord(entry.message)) return entry;
      const id = typeof entry.id === "string" ? entry.id : null;
      return id && isRecord(mapping[id]) ? mapping[id] : null;
    });
  } else {
    nodes = walkMapping(mapping);
    if (nodes.length > 0) {
      warnings.push(
        "Message order was reconstructed from the conversation tree.",
      );
    }
  }

  const messages: ParsedChatGptMessage[] = [];
  for (const node of nodes) {
    if (!isRecord(node) || !isRecord(node.message)) continue;
    const message = node.message;
    const author = isRecord(message.author) ? message.author : {};
    const role = roleFor(author.role);
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const channel =
      typeof message.channel === "string"
        ? message.channel
        : typeof metadata.channel === "string"
          ? metadata.channel
          : null;
    const recipient =
      typeof message.recipient === "string" ? message.recipient : null;
    if (metadata.is_visually_hidden_from_conversation === true) continue;
    if (role === "system" && !options.includeSystem) continue;
    if (role === "tool" && !options.includeToolOutput) continue;
    if (role === "assistant" && channel && channel !== "final") continue;
    if (role === "assistant" && recipient && recipient !== "all") continue;
    const flattened = flattenContent(message, options);
    if (!flattened.text && flattened.artifacts.length === 0) continue;
    if (isNonTranscriptPlaceholder(role, flattened.text)) continue;
    messages.push({
      role,
      authorName: authorNameFor(author, role),
      text: flattened.text,
      contentType: flattened.contentType,
      createdAt: timestampToIso(message.create_time),
      artifacts: flattened.artifacts,
    });
  }
  return messages;
}

export function parseChatGptShareUrl(sourceUrl: string) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new ChatGptShareParseError("The ChatGPT share URL is invalid.");
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const hasSupportedPath =
    (segments.length === 2 && segments[0] === "share") ||
    (segments.length === 3 && segments[0] === "share" && segments[1] === "e");
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    !["chatgpt.com", "chat.openai.com"].includes(host) ||
    !hasSupportedPath
  ) {
    throw new ChatGptShareParseError(
      "The URL is not a supported public ChatGPT share link.",
    );
  }
  const shareId = segments[1] === "e" ? segments[2] : segments[1];
  if (!shareId) {
    throw new ChatGptShareParseError(
      "The URL is not a supported public ChatGPT share link.",
    );
  }
  return { shareId, url };
}

export function parseChatGptShareHtml(
  html: string,
  sourceUrl: string,
  options: ChatGptParseOptions = {},
): ParsedChatGptShare {
  // Validate the caller-controlled URL before doing any potentially expensive
  // parsing, and use only the URL—not page data—as the external identifier.
  const { shareId } = parseChatGptShareUrl(sourceUrl);
  const resolvedOptions: Required<ChatGptParseOptions> = {
    includeReasoning: options.includeReasoning ?? false,
    includeSystem: options.includeSystem ?? false,
    includeToolOutput: options.includeToolOutput ?? false,
  };
  const warnings: string[] = [];
  let data: Record<string, Json> | undefined;

  const flightPool = extractFlightPool(html);
  if (flightPool) {
    const decoded = decodeFlightPool(flightPool);
    data = findObjects(decoded, looksLikeConversation, 5)[0];
  }

  if (!data) {
    const legacyScript = extractScripts(html).find(
      (script) => script.attributes.id === "__NEXT_DATA__",
    );
    const legacyPayload = legacyScript
      ? parseJson(legacyScript.text)
      : undefined;
    if (legacyPayload) {
      data = findObjects(legacyPayload, looksLikeConversation, 5)[0];
      if (data) warnings.push("The legacy ChatGPT share format was used.");
    }
  }

  if (!data) {
    if (
      /conversation (?:has been deleted|is unavailable|not found)|unable to load conversation|share_not_found/i.test(
        html,
      )
    ) {
      throw new ChatGptShareParseError(
        "The ChatGPT shared conversation is no longer available.",
        "unavailable",
      );
    }
    throw new ChatGptShareParseError(
      "No conversation payload was found in the ChatGPT share page.",
    );
  }

  const messages = buildMessages(data, resolvedOptions, warnings);
  if (messages.length === 0) {
    throw new ChatGptShareParseError(
      "The ChatGPT share contained no renderable messages.",
    );
  }

  const firstUserText = messages.find(
    (message) => message.role === "user",
  )?.text;
  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : firstUserText?.slice(0, 120).trim() || "Untitled conversation";
  const model =
    isRecord(data.model) && typeof data.model.slug === "string"
      ? data.model.slug
      : null;

  return {
    shareId,
    title,
    model,
    updatedAt: timestampToIso(data.update_time),
    messages,
    warnings,
  };
}
