import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/**
 * The confirmation step of the preview-before-send safety rule
 * (ADR 0007): after the preview, the CLI reads one line from stdin and
 * sends only on an explicit yes. Anything else aborts. There is no
 * `--yes` flag and no default-yes.
 */

/**
 * Whether an answer counts as an explicit yes: exactly "yes" or "y",
 * case-insensitive, ignoring surrounding whitespace. "yeah", "ok",
 * and "yes please" do not count.
 */
export function isYes(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "yes" || normalized === "y";
}

/**
 * Ask one confirmation question: write the prompt to `output` (stderr
 * in the real CLI, so stdout stays clean for `--json`), read one line
 * from `input` (stdin in the real CLI), and return whether the answer
 * is an explicit yes.
 */
export async function askConfirmation(
  prompt: string,
  input: Readable,
  output: Writable,
): Promise<boolean> {
  const lines: Interface = createInterface({ input, output });
  try {
    const answer = await new Promise<string>((resolve) => {
      lines.question(prompt, resolve);
    });
    return isYes(answer);
  } finally {
    lines.close();
  }
}
