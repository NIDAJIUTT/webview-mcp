// Attempts to force a third-party process's WebView-based UI (Electron/Tauri/
// Chromium) to build its accessibility tree by setting AXManualAccessibility
// on its top-level AXUIElement from the outside — i.e. without needing that
// app's source code.
//
// Background: Chromium-based renderers only build the full accessibility
// tree lazily, once some assistive client "asks" for it. Apps can opt in
// from their own source (`app.accessibilitySupportEnabled = true` in
// Electron). This script is the external equivalent for apps you don't
// control — but note Electron itself has a long-standing, acknowledged bug
// where setting this attribute sometimes fails with kAXErrorAttributeUnsupported
// (https://github.com/electron/electron/issues/37465). This tool reports
// that failure clearly instead of silently doing nothing, which is the
// actual gap in every other automation tool we looked at.
//
// Usage: swift wake_accessibility.swift <pid>
// Prints a single JSON line: {"ok":bool,"pid":int,"error":string|null}

import ApplicationServices
import Foundation

func printResult(ok: Bool, pid: Int32, error: String?) {
    var obj: [String: Any] = ["ok": ok, "pid": Int(pid)]
    if let error = error { obj["error"] = error }
    if let data = try? JSONSerialization.data(withJSONObject: obj),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        print("{\"ok\":false,\"error\":\"failed to serialize result\"}")
    }
}

let argv = CommandLine.arguments
guard argv.count >= 2, let pid = Int32(argv[1]) else {
    printResult(ok: false, pid: 0, error: "usage: wake_accessibility <pid>")
    exit(1)
}

let appElement = AXUIElementCreateApplication(pid)
let attribute = "AXManualAccessibility" as CFString
let status = AXUIElementSetAttributeValue(appElement, attribute, kCFBooleanTrue)

switch status {
case .success:
    printResult(ok: true, pid: pid, error: nil)
case .attributeUnsupported:
    printResult(
        ok: false, pid: pid,
        error: "kAXErrorAttributeUnsupported — this app's Chromium/Electron build does not accept external AXManualAccessibility (known Electron bug #37465). Fall back to toggling VoiceOver briefly, or to the dump_tree/retry strategy."
    )
case .notImplemented:
    printResult(ok: false, pid: pid, error: "kAXErrorNotImplemented — target process does not support the accessibility API at all (not a WebView-based app, or accessibility is disabled system-wide).")
default:
    printResult(ok: false, pid: pid, error: "AXError \(status.rawValue)")
}
