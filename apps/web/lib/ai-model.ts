import "server-only";

export const DEFAULT_OPENAI_MODEL = "gpt-5";

export function getOpenAIModel() {
  const configured = process.env.CODEV_OPENAI_MODEL?.trim();
  return configured || DEFAULT_OPENAI_MODEL;
}
