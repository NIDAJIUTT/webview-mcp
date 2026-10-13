// JXA (JavaScript for Automation) worker.
// Invoked as: osascript -l JavaScript automation.js '["<json-args>"]'
// args[0] is a JSON string: { action, app, path, text, keys, modifiers, windowIndex, maxDepth, maxNodes }

ObjC.import("stdlib");
ObjC.import("AppKit");

const SE = () => Application("System Events");

function setClipboardText(text) {
  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;
  pb.setStringForType(text, $.NSPasteboardTypeString);
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function describeNode(el) {
  return {
    role: safe(() => el.role()),
    name: safe(() => el.name()),
    title: safe(() => el.title && el.title()),
    value: safe(() => el.value()),
    description: safe(() => el.description()),
    help: safe(() => el.helpText && el.helpText()),
    enabled: safe(() => el.enabled()),
    position: safe(() => el.position()),
    size: safe(() => el.size()),
  };
}

function getProcess(appName) {
  const proc = SE().processes[appName];
  if (!proc.exists()) {
    throw new Error(`No running process named "${appName}". Use action=list_processes to see running GUI apps.`);
  }
  return proc;
}

function getWindow(appName, windowIndex) {
  const proc = getProcess(appName);
  const windows = proc.windows;
  const count = safe(() => windows.length, 0);
  if (count === 0) throw new Error(`Process "${appName}" has no windows.`);
  const idx = windowIndex == null ? 0 : windowIndex;
  if (idx >= count) throw new Error(`Window index ${idx} out of range (process has ${count} window(s)).`);
  return windows[idx];
}

function childrenOf(el) {
  try {
    const kids = el.uiElements();
    const out = [];
    for (let i = 0; i < kids.length; i++) out.push(kids[i]);
    return out;
  } catch (e) {
    return [];
  }
}

function walk(el, path, depth, maxDepth, maxNodes, counter) {
  if (counter.n >= maxNodes) return null;
  counter.n += 1;
  const node = describeNode(el);
  node.path = path;
  if (depth < maxDepth) {
    const kids = childrenOf(el);
    if (kids.length) {
      const children = [];
      for (let i = 0; i < kids.length; i++) {
        if (counter.n >= maxNodes) {
          node.truncated = true;
          break;
        }
        const childNode = walk(kids[i], path.concat([i]), depth + 1, maxDepth, maxNodes, counter);
        if (childNode) children.push(childNode);
      }
      if (children.length) node.children = children;
    }
  }
  return node;
}

// Re-locate an element by walking a path of child indices from a root window.
function resolveByPath(root, path) {
  let el = root;
  for (const idx of path) {
    const kids = childrenOf(el);
    if (idx >= kids.length) {
      throw new Error(
        `Path segment ${idx} out of range while resolving [${path.join(",")}] ` +
          `(node at this depth only has ${kids.length} children — the UI likely changed since dump_tree was called; re-run dump_tree).`
      );
    }
    el = kids[idx];
  }
  return el;
}

function actionDumpTree(p) {
  const win = getWindow(p.app, p.windowIndex);
  const maxDepth = p.maxDepth ?? 12;
  const maxNodes = p.maxNodes ?? 400;
  const counter = { n: 0 };
  const tree = walk(win, [], 0, maxDepth, maxNodes, counter);
  return { ok: true, nodeCount: counter.n, tree };
}

function actionClick(p) {
  const win = getWindow(p.app, p.windowIndex);
  const el = resolveByPath(win, p.path);
  try {
    el.actions["AXPress"].perform();
  } catch (e) {
    // Fallback: plain .click() works for most clickable roles.
    el.click();
  }
  return { ok: true, clicked: describeNode(el) };
}

// Sets text via a direct AXValue set. Works for native AppKit fields (e.g.
// NSOpenPanel's "go to folder" field) but WebView-based inputs (Electron/
// Tauri/React) commonly ignore it silently, because no real DOM input event
// fires — the framework's onChange never runs, so the UI reverts it.
function actionSetText(p) {
  const win = getWindow(p.app, p.windowIndex);
  const el = resolveByPath(win, p.path);
  const text = p.text ?? "";

  let strategy = "direct";
  try {
    el.value = text;
  } catch (e) {
    strategy = "direct-threw";
  }
  const after = safe(() => el.value());
  return { ok: after === text, strategy, value: after, expected: text };
}

// Same as actionSetText, but when the direct AXValue set doesn't stick, falls
// back to focusing the field and pasting via the system clipboard, which
// *does* dispatch a real paste/input event — the trick that rescues
// React/MUI-controlled inputs in WebView apps that a plain AXValue set can't
// touch.
function actionSetTextPro(p) {
  const direct = actionSetText(p);
  if (direct.ok) return direct;

  const win = getWindow(p.app, p.windowIndex);
  const el = resolveByPath(win, p.path);
  const text = p.text ?? "";

  const strategy = "paste";
  const se = SE();
  try {
    el.click();
  } catch (e) {
    // element might not support click (e.g. it's already focused); ignore.
  }
  delay(0.15);
  se.keystroke("a", { using: "command down" });
  delay(0.1);
  setClipboardText(text);
  delay(0.1);
  se.keystroke("v", { using: "command down" });
  delay(0.2);
  const finalValue = safe(() => el.value());
  return { ok: finalValue === text, strategy, value: finalValue, expected: text };
}

function actionPressKey(p) {
  const se = SE();
  const mods = (p.modifiers || []).map((m) => `${m} down`);
  if (p.keyCode != null) {
    if (mods.length) se.keyCode(p.keyCode, { using: mods });
    else se.keyCode(p.keyCode);
  } else {
    if (mods.length) se.keystroke(p.keys, { using: mods });
    else se.keystroke(p.keys);
  }
  return { ok: true };
}

function actionListProcesses() {
  const procs = SE().processes;
  const out = [];
  const n = procs.length;
  for (let i = 0; i < n; i++) {
    const proc = procs[i];
    const visible = safe(() => proc.visible(), false);
    if (!visible) continue;
    out.push({
      name: safe(() => proc.name()),
      bundleIdentifier: safe(() => proc.bundleIdentifier()),
      unixId: safe(() => proc.unixId()),
      frontmost: safe(() => proc.frontmost(), false),
      windowCount: safe(() => proc.windows.length, 0),
    });
  }
  return { ok: true, processes: out };
}

function actionFocusApp(p) {
  const app = Application(p.app);
  app.activate();
  return { ok: true };
}

function run(argv) {
  const params = JSON.parse(argv[0]);
  let result;
  switch (params.action) {
    case "dump_tree":
      result = actionDumpTree(params);
      break;
    case "click":
      result = actionClick(params);
      break;
    case "set_text":
      result = actionSetText(params);
      break;
    case "set_text_pro":
      result = actionSetTextPro(params);
      break;
    case "press_key":
      result = actionPressKey(params);
      break;
    case "list_processes":
      result = actionListProcesses();
      break;
    case "focus_app":
      result = actionFocusApp(params);
      break;
    default:
      result = { ok: false, error: `Unknown action: ${params.action}` };
  }
  return JSON.stringify(result);
}
