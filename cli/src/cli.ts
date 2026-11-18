#!/usr/bin/env node
import { getNetworkConfig } from "@skelsol/template";
import { Connection } from "@solana/web3.js";

import { CliError, helpText, isHelpRequest, parseArgs } from "./args.js";
import { runCommand, type RunDeps } from "./commands.js";
import { askConfirmation } from "./confirm.js";
import { loadKeypairFromFile } from "./keypair.js";

/**
 * `skel`: the command-line interface for AI agents to use Skelsol.
 * The entry point only wires the real I/O (a live web3.js Connection,
 * stdin/stdout/stderr) into `runCommand` and turns failures into a
 * one-line stderr message with exit code 1. All behavior lives in the
 * testable modules; nothing here is worth unit-testing directly.
 *
 * Output streams: previews and confirmation prompts go to stderr;
 * stdout carries only the final result, so `--json` output stays
 * parseable. Errors never print a stack trace.
 */

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`Error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  if (isHelpRequest(parsed)) {
    process.stdout.write(helpText(parsed.command));
    return 0;
  }

  // `disableRetryOnRateLimit` makes a 429 fail fast instead of
  // burning up to ~7.5s inside web3.js's own retry loop: the
  // reader's bounded retry (and skip-and-count) governs instead.
  // See ADR 0011.
  const connection = new Connection(
    getNetworkConfig(parsed.network).rpcEndpoint,
    { commitment: "confirmed", disableRetryOnRateLimit: true },
  );
  const deps: RunDeps = {
    connection,
    confirm: (prompt: string) =>
      askConfirmation(prompt, process.stdin, process.stderr),
    stdout: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
    stderr: (line: string) => {
      process.stderr.write(`${line}\n`);
    },
    readKeypair: loadKeypairFromFile,
  };

  try {
    return await runCommand(parsed, deps);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong.";
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
