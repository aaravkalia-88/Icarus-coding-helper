import AppKit
import ApplicationServices

func output(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) { FileHandle.standardOutput.write(data) }
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

guard CommandLine.arguments.count == 2 else { exit(1) }
switch CommandLine.arguments[1] {
case "target":
    // Application metadata only. No Accessibility content or clipboard reads.
    if let app = NSWorkspace.shared.frontmostApplication {
        output(["pid": app.processIdentifier, "name": app.localizedName ?? "your app"])
    } else { output([:]) }
case "capture":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count <= 100, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let pid = json["pid"] as? Int32, pid > 0,
          NSRunningApplication(processIdentifier: pid) != nil else { exit(1) }
    // The shortcut authorizes capture of the highlighted text only. Show the
    // app's recovery UI if macOS access is missing; do not launch system prompts.
    guard AXIsProcessTrusted() else { output(["status": "permission_needed"]); exit(0) }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 2)
    guard let focused = attribute(app, kAXFocusedUIElementAttribute) else { output(["status": "unavailable"]); exit(0) }
    let element = focused as! AXUIElement
    guard let text = attribute(element, kAXSelectedTextAttribute) as? String, !text.isEmpty else {
        output(["status": "empty"]); exit(0)
    }
    guard text.utf16.count <= 65536 else { output(["status": "unavailable"]); exit(0) }
    var result: [String: Any] = ["status": "selected", "selectedText": text]
    if let range = attribute(element, kAXSelectedTextRangeAttribute) {
        var value: CFTypeRef?
        if AXUIElementCopyParameterizedAttributeValue(element, kAXBoundsForRangeParameterizedAttribute as CFString, range, &value) == .success,
           let value = value, CFGetTypeID(value) == AXValueGetTypeID() {
            var rect = CGRect.zero
            if AXValueGetValue(value as! AXValue, .cgRect, &rect) {
                result["bounds"] = ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
            }
        }
    }
    output(result)
default: exit(1)
}
