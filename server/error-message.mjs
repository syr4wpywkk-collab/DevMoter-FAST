/**
 * The message to show a client for a caught value. Only an Error's own
 * `message` is used; anything else that was thrown (a string, an object, a
 * stack dump) is replaced by `fallback`, so stack traces never reach a response.
 */
export function errorMessage(error, fallback = "Unexpected error") {
  if (error instanceof Error && typeof error.message === "string" && error.message) return error.message;
  return fallback;
}
