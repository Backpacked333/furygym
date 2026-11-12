import Foundation

/// Connection settings, read from Info.plist. The values come from Config/Config.xcconfig at build
/// time, so no keys live in source control.
struct AppConfig {
    let supabaseURL: URL
    let supabaseAnonKey: String
    /// The Fury Co. web app: hosts checkout, the billing portal and account deletion.
    let webBaseURL: URL

    /// Nil when the build has no configuration yet (a fresh checkout without Config.xcconfig).
    static func load(from bundle: Bundle = .main) -> AppConfig? {
        func value(_ key: String) -> String? {
            guard let raw = bundle.object(forInfoDictionaryKey: key) as? String else { return nil }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty || trimmed.contains("YOUR_") ? nil : trimmed
        }
        guard let supabase = value("SupabaseURL").flatMap(URL.init(string:)), supabase.host != nil,
              let key = value("SupabaseAnonKey"),
              let web = value("WebBaseURL").flatMap(URL.init(string:)), web.host != nil
        else { return nil }
        return AppConfig(supabaseURL: supabase, supabaseAnonKey: key, webBaseURL: web)
    }
}
