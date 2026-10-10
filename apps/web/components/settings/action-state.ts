/** Result of a settings form's server action, read with `useActionState`. */
export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export const IDLE: ActionState = { status: "idle" };

export function actionResult(
  error: string | null,
  success: string,
): ActionState {
  return error
    ? { status: "error", message: error }
    : { status: "success", message: success };
}
