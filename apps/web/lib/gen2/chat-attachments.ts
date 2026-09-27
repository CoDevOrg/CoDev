/**
 * Chat-composer attachments for Gen 2: files land on the guest filesystem so
 * Codex can open them, then the prompt names their paths.
 */

export const GEN2_CHAT_UPLOAD_DIR = ".codev/uploads";
export const MAX_GEN2_CHAT_ATTACHMENTS = 5;
export const MAX_GEN2_CHAT_ATTACHMENT_BYTES = 1_024 * 1_024;

/** Basename only, safe for a guest relative path under the upload dir. */
export function sanitizeGen2UploadName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() || "file";
  const cleaned = base
    .replace(/[^\w.\-+=() \[\]{}]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return cleaned || "file";
}

export function gen2ChatUploadPath(name: string): string {
  return `${GEN2_CHAT_UPLOAD_DIR}/${sanitizeGen2UploadName(name)}`;
}

/** `File.text()` replaces undecodable bytes with U+FFFD. */
export function isNonTextFileContents(contents: string): boolean {
  return contents.includes("\uFFFD");
}

export function formatGen2AttachmentPrompt(
  paths: string[],
  text: string,
): string {
  const trimmed = text.trim();
  if (paths.length === 0) return trimmed;

  const list = paths.map((path) => `- \`${path}\``).join("\n");
  const header = `Attached files on this machine:\n${list}`;
  return trimmed
    ? `${header}\n\n${trimmed}`
    : `${header}\n\nPlease inspect these files.`;
}
