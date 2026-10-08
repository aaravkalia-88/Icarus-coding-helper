import Foundation
import Security

let provider = CommandLine.arguments.count == 3 ? CommandLine.arguments[2] : "huggingface"
guard ["huggingface", "openai"].contains(provider) else { exit(1) }
let service = "com.icarus.provider.\(provider)"
// Fresh entries trust this helper rather than an older build's access list.
let account = "api-key.no-password"
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

func output(_ value: String) {
    FileHandle.standardOutput.write(Data(value.utf8))
}

guard [2, 3].contains(CommandLine.arguments.count) else { exit(1) }
// LAContext alone does not suppress dialogs from the file-based login Keychain.
guard SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else { exit(1) }

switch CommandLine.arguments[1] {
case "set":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty, data.count <= 4096,
          let key = String(data: data, encoding: .utf8),
          !key.contains("\n"), !key.contains("\r"), !key.contains("\0") else { exit(1) }
    var item = query
    item[kSecValueData as String] = data
    let added = SecItemAdd(item as CFDictionary, nil)
    let result = added == errSecDuplicateItem
        ? SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        : added
    guard result == errSecSuccess else { exit(1) }
    output("ok")
case "get", "status":
    var item = query
    item[kSecReturnData as String] = true
    item[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    var status = SecItemCopyMatching(item as CFDictionary, &result)
    if status == errSecItemNotFound {
        item[kSecAttrAccount as String] = "api-key"
        status = SecItemCopyMatching(item as CFDictionary, &result)
        // An inaccessible legacy entry can be replaced by pasting the API key.
        if [errSecInteractionNotAllowed, errSecInteractionRequired, errSecAuthFailed].contains(status) {
            status = errSecItemNotFound
        }
    }
    if status == errSecItemNotFound {
        if CommandLine.arguments[1] == "get" { exit(2) }
        output("missing")
    } else {
        guard status == errSecSuccess, let data = result as? Data else { exit(1) }
        if CommandLine.arguments[1] == "get" { FileHandle.standardOutput.write(data) }
        else { output("present") }
    }
case "delete":
    for account in ["api-key", account] {
        var item = query
        item[kSecAttrAccount as String] = account
        let status = SecItemDelete(item as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { exit(1) }
    }
    output("ok")
default:
    exit(1)
}
