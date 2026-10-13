import { spawn } from "node:child_process";

/**
 * Runs a JXA (JavaScript for Automation) script file via osascript and
 * returns its parsed JSON result. The script must define `function run(argv)`
 * and return a JSON string.
 */
export function runJxa(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const cliArgs = args.map((a) => JSON.stringify(a));
    const proc = spawn("osascript", ["-l", "JavaScript", scriptPath, ...cliArgs]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`osascript exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`Failed to parse JXA output as JSON: ${stdout}\n${stderr}`));
      }
    });
    proc.on("error", reject);
  });
}
