#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runJxa } from "./jxa-runner.js";
import { wakeAccessibility } from "./wake-accessibility.js";
import { isProLicensed, PURCHASE_URL } from "./license.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTOMATION_SCRIPT = join(__dirname, "jxa", "automation.js");
const isPro = await isProLicensed();

function proRequiredError() {
  return {
    content: [
      {
        type: "text",
        text:
          `This tool requires a Pro license. Set WEBVIEW_MCP_LICENSE_KEY to a key purchased at ${PURCHASE_URL}, ` +
          "then restart the server.",
      },
    ],
    isError: true,
  };
}

function jxa(action, params = {}) {
  return runJxa(AUTOMATION_SCRIPT, [{ action, ...params }]);
}

function asResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function asError(err) {
  return { content: [{ type: "text", text: err.message || String(err) }], isError: true };
}

const server = new McpServer({ name: "webview-mcp", version: "0.1.0" });

server.registerTool(
  "list_processes",
  {
    title: "List running GUI processes",
    description:
      "Lists visible GUI processes (name, bundle id, pid, window count). Use this to find the app name to pass to other tools.",
    inputSchema: {},
  },
  async () => {
    try {
      return asResult(await jxa("list_processes"));
    } catch (e) {
      return asError(e);
    }
  }
);

server.registerTool(
  "focus_app",
  {
    title: "Focus an application",
    description: "Activates (brings to front) the named application.",
    inputSchema: { app: z.string().describe("Application name, as shown by list_processes") },
  },
  async ({ app }) => {
    try {
      return asResult(await jxa("focus_app", { app }));
    } catch (e) {
      return asError(e);
    }
  }
);

server.registerTool(
  "wake_accessibility",
  {
    title: "[Pro] Force a WebView app to build its accessibility tree",
    description:
      "Electron/Tauri/Chromium-based apps only build their full accessibility tree lazily, once something " +
      "requests it — otherwise dump_tree comes back empty. This tries to force that from the outside via " +
      "AXManualAccessibility, before you call dump_tree on a third-party app you don't control the source of. " +
      "Known limitation: some Electron builds reject this with kAXErrorAttributeUnsupported (electron#37465) — " +
      "the tool reports that explicitly so you know to fall back to a retry loop or a brief VoiceOver toggle " +
      `instead of assuming the app simply has no UI. Requires a Pro license (${PURCHASE_URL}).`,
    inputSchema: {
      pid: z.number().int().optional().describe("Process id. Provide this or app."),
      app: z.string().optional().describe("Application name to resolve to a pid via list_processes. Provide this or pid."),
    },
  },
  async ({ pid, app }) => {
    if (!isPro) return proRequiredError();
    try {
      let targetPid = pid;
      if (targetPid == null) {
        if (!app) throw new Error("Provide either pid or app.");
        const { processes } = await jxa("list_processes");
        const match = processes.find((p) => p.name === app);
        if (!match) throw new Error(`No running visible process named "${app}".`);
        targetPid = match.unixId;
      }
      return asResult(await wakeAccessibility(targetPid));
    } catch (e) {
      return asError(e);
    }
  }
);

server.registerTool(
  "dump_tree",
  {
    title: "Dump an app window's accessibility tree",
    description:
      "Walks the accessibility tree of a window, returning role/name/value/position for each element plus its " +
      "`path` (array of child indices) — pass that path back into click/set_text to act on a specific element. " +
      "If this comes back with nodeCount near 0 for a WebView-based app, call wake_accessibility first and retry.",
    inputSchema: {
      app: z.string().describe("Application name, as shown by list_processes"),
      windowIndex: z.number().int().optional().describe("0-based window index (default 0)"),
      maxDepth: z.number().int().optional().describe("Max tree depth (default 12)"),
      maxNodes: z.number().int().optional().describe("Max total nodes to visit (default 400)"),
    },
  },
  async ({ app, windowIndex, maxDepth, maxNodes }) => {
    try {
      return asResult(await jxa("dump_tree", { app, windowIndex, maxDepth, maxNodes }));
    } catch (e) {
      return asError(e);
    }
  }
);

server.registerTool(
  "click",
  {
    title: "Click an accessibility element",
    description: "Clicks the element at `path` (from dump_tree) in the given app's window, via AXPress with a plain-click fallback.",
    inputSchema: {
      app: z.string(),
      windowIndex: z.number().int().optional(),
      path: z.array(z.number().int()).describe("Child-index path to the element, from dump_tree"),
    },
  },
  async ({ app, windowIndex, path }) => {
    try {
      return asResult(await jxa("click", { app, windowIndex, path }));
    } catch (e) {
      return asError(e);
    }
  }
);

server.registerTool(
  "set_text",
  {
    title: "Set a text field's value",
    description:
      "Sets the value of a text element at `path` via a direct AXValue set — works for native AppKit fields. " +
      "WebView UIs (React/MUI etc) commonly ignore this silently because no real input event fires; the Pro " +
      `tier (${PURCHASE_URL}) adds a clipboard-paste fallback that dispatches a genuine input event and ` +
      "reliably sticks on those.",
    inputSchema: {
      app: z.string(),
      windowIndex: z.number().int().optional(),
      path: z.array(z.number().int()).describe("Child-index path to the text element, from dump_tree"),
      text: z.string(),
    },
  },
  async ({ app, windowIndex, path, text }) => {
    try {
      const action = isPro ? "set_text_pro" : "set_text";
      const result = await jxa(action, { app, windowIndex, path, text });
      if (!result.ok && !isPro) {
        result.hint = `Direct set didn't stick — this is likely a WebView input. Pro adds a paste fallback that handles this: ${PURCHASE_URL}`;
      }
      return asResult(result);
    } catch (e) {
      return asError(e);
    }
  }
);

server.registerTool(
  "press_key",
  {
    title: "Send a keystroke",
    description: "Sends a keystroke (by character or key code) with optional modifiers to the frontmost app via System Events.",
    inputSchema: {
      keys: z.string().optional().describe("Characters to type, e.g. 'a'. Mutually exclusive with keyCode."),
      keyCode: z.number().int().optional().describe("Raw key code, e.g. 36 for Return. Mutually exclusive with keys."),
      modifiers: z
        .array(z.enum(["command", "shift", "option", "control"]))
        .optional()
        .describe("Modifier keys held during the keystroke."),
    },
  },
  async ({ keys, keyCode, modifiers }) => {
    try {
      return asResult(await jxa("press_key", { keys, keyCode, modifiers }));
    } catch (e) {
      return asError(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
