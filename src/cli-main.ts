#!/usr/bin/env node
import { runCli, invokedDirectly } from "./cli.js";
import { AmcError } from "./types.js";

if (invokedDirectly(import.meta.url)) {
  void runCli(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof AmcError) {
        console.error(`error: ${error.message}`);
        process.exitCode = error.exitCode;
      } else {
        console.error(`error: ${(error as Error).message ?? error}`);
        process.exitCode = 1;
      }
    });
}
