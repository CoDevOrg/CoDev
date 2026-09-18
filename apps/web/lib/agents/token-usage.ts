export type TokenUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export function normalizeTokenUsage(
  value: unknown,
): TokenUsageSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const inputTokens = numberOrZero(
    record.inputTokens ?? record.promptTokens ?? record.input,
  );
  const outputTokens = numberOrZero(
    record.outputTokens ?? record.completionTokens ?? record.output,
  );
  const totalTokens = numberOrZero(
    record.totalTokens ?? record.total ?? inputTokens + outputTokens,
  );
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens > 0 ? totalTokens : inputTokens + outputTokens,
  };
}

export function estimateTokenUsage(text: string): TokenUsageSummary {
  const totalTokens = Math.max(1, Math.ceil(text.trim().length / 4));
  return {
    inputTokens: 0,
    outputTokens: totalTokens,
    totalTokens,
  };
}

export function formatTokenCount(count: number) {
  return count.toLocaleString("en-US");
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}
