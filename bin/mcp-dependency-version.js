#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const entrypoint = resolve(here, "..", "main.ts");

if ("Bun" in globalThis) {
  await import(pathToFileURL(entrypoint).href);
} else {
  const npmExecPath = process.env.npm_execpath ?? "";
  const npmUserAgent = process.env.npm_config_user_agent ?? "";
  const launchedByBun = npmExecPath.includes("bun") ||
    npmUserAgent.startsWith("bun/");

  const command = launchedByBun ? "bun" : process.execPath;
  const args = launchedByBun ? ["run", entrypoint, ...process.argv.slice(2)] : [
    fileURLToPath(import.meta.resolve("tsx/cli")),
    entrypoint,
    ...process.argv.slice(2),
  ];

  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`Failed to start ${command}: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
