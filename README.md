# webview-mcp

An MCP server for automating macOS GUI apps via the Accessibility API — AppleScript/JXA under the hood, exposed as MCP tools so an AI agent can drive apps it has no API for.

Most of that is already solved by other AppleScript-MCP projects. The reason this one exists: **Electron/Tauri/Chromium-based apps (WebView apps) routinely break plain accessibility automation.** They build their accessibility tree lazily — nothing requests it, so `dump_tree` comes back empty — and a direct `set value of` on a text field gets silently reverted because no real input event fired for React/MUI to react to. This showed up for real debugging [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) (a Tauri app) — repeatable, not a one-off.

## Free tier

- `list_processes` — list visible GUI processes
- `focus_app` — activate an app
- `dump_tree` — walk a window's accessibility tree, returns a `path` per element
- `click` — click an element by path
- `set_text` — direct AXValue set (works on native AppKit fields; silently no-ops on most WebView inputs — this is the documented limitation Pro fixes)
- `press_key` — send a keystroke with modifiers

## Pro ($49 one-time, [buy here](https://webviewmcp.gumroad.com/l/pro))

- `wake_accessibility` — forces a WebView app's accessibility tree to build via `AXManualAccessibility`, from *outside* the app (no source access needed). Reports the known Electron limitation (`kAXErrorAttributeUnsupported`, [electron#37465](https://github.com/electron/electron/issues/37465)) explicitly instead of failing silently.
- `set_text` paste fallback — when the direct set doesn't stick, falls back to focus + select-all + clipboard paste, which *does* dispatch a real input event. This is the fix for React/MUI-controlled fields in Electron/Tauri apps.

Pro is a license key, verified against Gumroad, cached locally for a week so the server works offline between checks.

```bash
export WEBVIEW_MCP_LICENSE_KEY="your-key-from-gumroad"
export WEBVIEW_MCP_GUMROAD_PRODUCT_ID="<set after creating the product>"
```

## Install

```bash
git clone https://github.com/<you>/webview-mcp.git
cd webview-mcp
npm install
```

Add to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "webview-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/webview-mcp/src/index.js"],
      "env": {
        "WEBVIEW_MCP_LICENSE_KEY": "your-key-from-gumroad",
        "WEBVIEW_MCP_GUMROAD_PRODUCT_ID": "..."
      }
    }
  }
}
```

The server will prompt macOS for Accessibility permission (System Settings → Privacy & Security → Accessibility) the first time it drives another app.

## Why not just use the existing AppleScript-MCP projects?

They're a fine starting point for native AppKit apps, and this one's free tier covers the same ground. The gap is specifically WebView apps you don't control the source of — which is most of what's shipping as a desktop app in 2026. If `dump_tree` comes back with only native window-chrome elements (close/zoom/minimize buttons) and nothing from the actual content area, that's this problem.

## License

MIT for everything in this repo. The Pro tier is a server-side license check, not code obfuscation — the code is readable either way, you're paying for the working fallback logic and not having to rediscover it.
