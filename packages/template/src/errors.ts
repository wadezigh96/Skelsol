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
