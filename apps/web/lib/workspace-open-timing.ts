export class WorkspaceOpenTiming {
  private readonly stages: Array<{ name: string; duration: number }> = [];

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.stages.push({ name, duration: performance.now() - started });
    }
  }

  headers(): Record<string, string> {
    return {
      "Cache-Control": "no-store",
      "Server-Timing": this.stages
        .map(({ name, duration }) => `${name};dur=${duration.toFixed(1)}`)
        .join(", "),
    };
  }
}
