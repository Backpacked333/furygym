import SwiftUI

/// Placeholder brand theme. Swap these for Fury Co.'s colours and type when supplied.
enum Theme {
    static let background = Color(hex: "#0B0B0D")
    static let surface = Color(hex: "#141417")
    static let raised = Color(hex: "#1B1B20")
    static let line = Color(hex: "#2A2A31")
    static let muted = Color(hex: "#9D9DA8")
    static let accent = Color(hex: "#E5484D")
    static let good = Color(hex: "#3E9B6E")
    static let warn = Color(hex: "#F5A524")
}

extension Color {
    /// "#RRGGBB". Falls back to mid-grey for anything else, e.g. a track with no colour set.
    init(hex: String?) {
        let cleaned = (hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else {
            self = Color.gray
            return
        }
        self = Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
    }
}

struct TrackDot: View {
    let hex: String?

    var body: some View {
        Circle().fill(Color(hex: hex)).frame(width: 8, height: 8).accessibilityHidden(true)
    }
}

struct Pill: View {
    let text: String
    var color: Color = Theme.muted

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.15), in: Capsule())
    }
}

struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(1)
            .foregroundStyle(Theme.muted)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Theme.accent.opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.4), in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(.white)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Theme.raised.opacity(configuration.isPressed ? 0.6 : 1), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
            .foregroundStyle(.white)
    }
}

/// An inline message for something that went wrong, announced to VoiceOver.
struct ErrorText: View {
    let message: String?

    var body: some View {
        if let message {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(Theme.warn)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isStaticText)
        }
    }
}

/// Loads a value, shows it, and offers a retry when loading fails. `reloadKey` re-runs the load
/// (for example when another tab changed something).
struct AsyncContent<Value, Content: View>: View {
    let reloadKey: Int
    let load: () async throws -> Value
    @ViewBuilder let content: (Value) -> Content

    @State private var value: Value?
    @State private var error: String?

    var body: some View {
        Group {
            if let value {
                content(value)
            } else if let error {
                ContentUnavailableView {
                    Label("Couldn't load", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try again") { Task { await reload() } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: reloadKey) { await reload() }
        .refreshable { await reload() }
    }

    private func reload() async {
        do {
            value = try await load()
            error = nil
        } catch is CancellationError {
            // The view went away; nothing to show.
        } catch {
            // A load interrupted by leaving the screen is not a failure worth showing.
            if Task.isCancelled { return }
            // Keep showing what we already have if a refresh fails.
            if value == nil { self.error = Backend.message(for: error) }
        }
    }
}

extension View {
    /// The app's page background behind scrolling content.
    func screenBackground() -> some View {
        scrollContentBackground(.hidden).background(Theme.background.ignoresSafeArea())
    }
}
