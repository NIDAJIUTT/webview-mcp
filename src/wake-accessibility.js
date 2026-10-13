import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NATIVE_DIR = join(__dirname, "..", "native");
const SOURCE = join(NATIVE_DIR, "wake_accessibility.swift");
const BINARY = join(NATIVE_DIR, ".build", "wake_accessibility");

function ensureCompiled() {
  if (existsSync(BINARY)) return;
  mkdirSync(dirname(BINARY), { recursive: true });
  const result = spawnSync("swiftc", ["-O", SOURCE, "-o", BINARY], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Failed to compile wake_accessibility.swift: ${result.stderr || result.stdout}`);
  }
}

/**
 * Tries to force the given process's WebView-based UI (Electron/Tauri/Chromium)
 * to build its accessibility tree via AXManualAccessibility. Returns the parsed
 * {ok, pid, error} result even on failure — the caller decides whether to fall
 * back to a retry/VoiceOver-toggle strategy.
 */
export function wakeAccessibility(pid) {
  ensureCompiled();
  return new Promise((resolve, reject) => {
    const proc = spawn(BINARY, [String(pid)]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`Failed to parse wake_accessibility output: ${stdout}\n${stderr}`));
      }
    });
    proc.on("error", reject);
  });
}
