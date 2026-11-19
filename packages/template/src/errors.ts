/**
 * Shared error wording for the template.
 *
 * The plain-words messages the template shows a user live here, in one
 * place, so the reader, the market client, the CLI, and the apps all say
 * the same thing for the same failure instead of each spelling it
 * slightly differently.
 */

/**
 * What every network read says when the RPC cannot be reached: the
 * reader, the market client, the CLI, and the apps all use this one
 * message for an RPC failure, so a user sees the same words no matter
 * which part of Skelsol they are using.
 */
export const NETWORK_UNREACHABLE_MESSAGE =
  "Could not reach the network, try again.";

/**
 * The deepest underlying error message in an error's `cause` chain,
 * or null when the error has no cause. The template wraps raw RPC
 * errors in plain-words errors, so the cause is where the real
 * reason lives ("429 Too Many Requests", "fetch failed"). Truncated
 * to `maxLength` characters so a huge raw message never floods a
 * status line.
 */
export function errorCauseMessage(
  error: unknown,
  maxLength = 80,
): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  let deepest: string | null = null;
  let current: unknown = error.cause;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof Error) {
      deepest = current.message;
      current = current.cause;
    } else if (typeof current === "string" && current !== "") {
      deepest = current;
      break;
    } else {
      break;
    }
  }
  if (deepest === null) {
    return null;
  }
  return deepest.length > maxLength
    ? `${deepest.slice(0, maxLength)}…`
    : deepest;
}

/**
 * A user-facing message with its underlying cause appended in
 * parentheses ("…right now. (429 Too Many Requests)"), or the
 * message unchanged when there is no cause. The cause is what a
 * diagnostic needs; the plain message is what a user reads first.
 */
export function withCause(message: string, error: unknown): string {
  const cause = errorCauseMessage(error);
  return cause === null ? message : `${message} (${cause})`;
}
