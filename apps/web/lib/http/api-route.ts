import "server-only";

import { apiError, getApiUser, getApiUserAnyAuth } from "@/lib/http/api";
import type { AppUser } from "@/lib/auth/identity";
import { databaseErrorResponse } from "./database-error";
import { forwardedRequest } from "./forwarded-request";

/**
 * The one way an `app/api` route authenticates, reads its body, and turns a
 * thrown error into a response.
 *
 * Throw `ApiError` (or any error with a numeric `status`) to choose the
 * response status, or an error with a
 * `toResponse()` method to choose the whole response. Anything else becomes
 * the route's `errorStatus` (400 unless the route says otherwise) and its
 * message is returned, which matches what the routes did before.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ResponseError = Error & { toResponse(): Response };

function hasOwnResponse(error: unknown): error is ResponseError {
  return (
    error instanceof Error &&
    "toResponse" in error &&
    typeof error.toResponse === "function"
  );
}

/**
 * The response for an error thrown inside a route. Errors that know their own
 * body (`OrchestratorError` adds `conflictPaths`, `QuotaError` adds `code` and
 * `Retry-After`) provide `toResponse()`; everything else is `{ error }`.
 */
export function errorResponse(error: unknown, fallbackStatus = 400) {
  const databaseResponse = databaseErrorResponse(error);
  if (databaseResponse) return databaseResponse;
  if (hasOwnResponse(error)) return error.toResponse();
  return apiError(error, errorStatus(error, fallbackStatus));
}

/** The status an error asks for, when it carries a valid one. */
export function errorStatus(error: unknown, fallback = 400): number {
  if (error instanceof Error && "status" in error) {
    const status = Number(error.status);
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }
  }
  return fallback;
}

/**
 * Anything with Zod's `safeParse`. Typed structurally rather than as
 * `z.ZodType` because `@codev/contracts` and this app can resolve different
 * zod versions, whose `ZodType`s are not assignable to each other.
 */
type SafeParser<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
};

/** Parses a JSON body against `schema`, or throws a 400 with `message`. */
export async function readJson<T>(
  request: Request,
  schema: SafeParser<T>,
  message = "Invalid request body.",
): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) throw new ApiError(message, 400);
  return parsed.data;
}

type RouteParams = Record<string, string | string[] | undefined>;
type RouteContext<P> = { params: Promise<P> };

export type RouteOptions = {
  /**
   * Also accept a `codev_cli_...` bearer token (CLI, mobile). Leave off for
   * routes only the browser calls.
   */
  anyAuth?: boolean;
  /** Status for errors that do not carry their own. Defaults to 400. */
  errorStatus?: number;
};

export type UserRouteInput<P> = {
  request: Request;
  user: AppUser;
  params: P;
};

export function withUser<P extends RouteParams = Record<string, never>>(
  handler: (input: UserRouteInput<P>) => Response | Promise<Response>,
  options: RouteOptions = {},
) {
  return async (request: Request, context: RouteContext<P>) => {
    try {
      const user = options.anyAuth
        ? await getApiUserAnyAuth(request)
        : await getApiUser();
      if (!user) return apiError(new Error("Authentication required."), 401);
      const params = ((await context?.params) ?? {}) as P;
      return await handler({
        request: forwardedRequest(request),
        user,
        params,
      });
    } catch (error) {
      return errorResponse(error, options.errorStatus);
    }
  };
}
