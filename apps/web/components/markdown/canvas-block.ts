// ChatGPT exports a "canvas" document (its separate writing/coding surface)
// inline in the transcript as a pseudo-markdown container directive —
// `:::writing{variant="email" subject="..."} <content> :::` — with the
// fence markers run into the surrounding text rather than on their own
// lines, so it doesn't parse as a real remark directive. This recognizes
// that one shape and pulls the attributes and inner content back out.
const CANVAS_BLOCK =
  /^:::([a-zA-Z][\w-]*)(?:\{([^}]*)\})?\s*([\s\S]*?)\s*:::\s*$/;
const ATTRIBUTE = /(\w+)="([^"]*)"/g;

export type CanvasBlock = {
  variant: string;
  attributes: Record<string, string>;
  content: string;
};

export function parseCanvasBlock(text: string): CanvasBlock | null {
  const match = CANVAS_BLOCK.exec(text.trim());
  if (!match) return null;
  const [, variant, attrs, content] = match;
  if (!variant || !content) return null;

  const attributes: Record<string, string> = {};
  for (const [, key, value] of attrs?.matchAll(ATTRIBUTE) ?? []) {
    if (key) attributes[key] = value ?? "";
  }

  return { variant, attributes, content };
}
