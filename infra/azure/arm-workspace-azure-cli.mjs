import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const transient =
  /Conflict|OperationNotAllowed|TooManyRequests|RetryableError|ServiceUnavailable|InternalServerError|GatewayTimeout|AllocationFailed|starting|stopping|deallocating/i;

export async function azureCli(args, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { stdout } = await run("az", args, {
        timeout: 180_000,
        maxBuffer: 4 << 20,
      });
      return stdout.trim();
    } catch (error) {
      const detail = String(error.stderr || error.message);
      const code = detail.match(/(?:Code: |\()([A-Za-z]+)(?:\)|\n)/)?.[1];
      if (!transient.test(detail) || attempt === attempts - 1) {
        const failure = new Error(code || "AZURE_OPERATION_FAILED");
        failure.code = code;
        throw failure;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(30_000, 1000 * 2 ** attempt)),
      );
    }
  }
  throw new Error("AZURE_OPERATION_FAILED");
}
