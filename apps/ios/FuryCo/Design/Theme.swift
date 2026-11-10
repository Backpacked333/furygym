import SwiftUI

/// Fury Co. design tokens, from "Fury Design System": a true-black canvas, iOS grouped surfaces,
/// Fury red as the one accent, and a colour per training track.
enum FC {
    static let bg = Color.black
    static let bg2 = Color(hex: "#1C1C1E")
    static let bg3 = Color(hex: "#2C2C2E")
    static let bg4 = Color(hex: "#3A3A3C")
    /// Secondary and tertiary label colours.
    static let label2 = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.7)
    static let label3 = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.3)
    static let fill = Color(red: 118 / 255, green: 118 / 255, blue: 128 / 255).opacity(0.24)
    static let fillSoft = Color(red: 118 / 255, green: 118 / 255, blue: 128 / 255).opacity(0.18)
    static let separator = Color.white.opacity(0.17)
    static let red = Color(hex: "#FF4245")
    static let redFill = Color(hex: "#E9152D")
    static let redHi = Color(hex: "#FF6165")
    static let green = Color(hex: "#30D158")
    static let orange = Color(hex: "#FF9230")
    static let yellow = Color(hex: "#FFD600")
    static let indigo = Color(hex: "#6D7CFF")
    static let gray = Color(hex: "#8E8E93")

    static let cardRadius: CGFloat = 26
    static let fieldRadius: CGFloat = 16
    static let sheetRadius: CGFloat = 46
    static let screenPadding: CGFloat = 16

    /// Big numbers: PRs, timers, stats.
    static func metric(_ size: CGFloat) -> Font {
        .system(size: size, weight: size >= 30 ? .heavy : .bold).monospacedDigit()
    }
}

extension Color {
    /// "#RRGGBB". Falls back to the neutral track grey for anything else.
    init(hex: String?) {
        let cleaned = (hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else {
            self = Color(red: 142 / 255, green: 142 / 255, blue: 147 / 255)
            return
        }
        self = Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

// MARK: Surfaces

/// The standard grouped card: 26pt corners on the secondary background.
struct FCard<Content: View>: View {
    var padding: CGFloat = 16
    var spacing: CGFloat = 12
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FC.bg2, in: RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
    }
}

/// A glass capsule or circle for controls that float over content.
struct GlassBackground<S: Shape>: View {
    let shape: S

    var body: some View {
        shape.fill(.ultraThinMaterial)
            .overlay(shape.fill(Color(red: 118 / 255, green: 118 / 255, blue: 128 / 255).opacity(0.18)))
            .overlay(shape.stroke(Color.white.opacity(0.18), lineWidth: 0.5))
    }
}

/// The dark striped backdrop with a red glow that stands in where photography will go.
struct HeroBackdrop: View {
    var tint: Color = FC.redFill

    var body: some View {
        ZStack {
            Color(hex: "#151517")
            RadialGradient(colors: [tint.opacity(0.42), tint.opacity(0)], center: UnitPoint(x: 0.75, y: 0.22), startRadius: 0, endRadius: 280)
            LinearGradient(colors: [.clear, .black], startPoint: .center, endPoint: .bottom)
        }
        .accessibilityHidden(true)
    }
}

// MARK: Buttons

struct FCButtonStyle: ButtonStyle {
    enum Kind { case filled, glass, gray, tinted, white, outline, destructive }
    enum Size { case large, medium, small }

    var kind: Kind = .filled
    var size: Size = .large
    var fullWidth = true
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let height: CGFloat = size == .large ? 50 : size == .medium ? 34 : 28
        let font: Font = size == .large ? .headline : size == .medium ? .subheadline.weight(.semibold) : .footnote.weight(.semibold)
        return configuration.label
            .font(font)
            .lineLimit(1)
            .padding(.horizontal, size == .large ? 24 : size == .medium ? 14 : 12)
            .frame(maxWidth: fullWidth && size == .large ? .infinity : nil, minHeight: height, maxHeight: height)
            .foregroundStyle(foreground)
            .background(background)
            .clipShape(Capsule())
            .overlay(kind == .outline ? Capsule().stroke(Color.white.opacity(0.55), lineWidth: 1.5) : nil)
            .shadow(color: kind == .filled && isEnabled ? FC.redFill.opacity(0.32) : .clear, radius: 12, y: 8)
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .contentShape(Capsule())
    }

    private var foreground: Color {
        switch kind {
        case .filled, .glass, .gray, .outline: return .white
        case .tinted: return FC.redHi
        case .white: return .black
        case .destructive: return FC.red
        }
    }

    @ViewBuilder private var background: some View {
        switch kind {
        case .filled: FC.redFill
        case .glass: GlassBackground(shape: Capsule())
        case .gray, .destructive: FC.fill
        case .tinted: FC.red.opacity(0.16)
        case .white: Color.white
        case .outline: Color.black.opacity(0.32)
        }
    }
}

extension ButtonStyle where Self == FCButtonStyle {
    static var fcFilled: FCButtonStyle { FCButtonStyle() }
    static func fc(_ kind: FCButtonStyle.Kind, size: FCButtonStyle.Size = .large, fullWidth: Bool = true) -> FCButtonStyle {
        FCButtonStyle(kind: kind, size: size, fullWidth: fullWidth)
    }
}

/// A 44pt round glass button holding one SF Symbol.
struct GlassIconButton: View {
    let systemName: String
    let label: String
    var tint: Color = .white
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .background(GlassBackground(shape: Circle()))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: Labels

struct Chip: View {
    let text: String
    var color: Color = FC.red
    var dot = false
    var systemImage: String?
    var solid = false

    var body: some View {
        HStack(spacing: 5) {
            if dot { Circle().fill(color).frame(width: 6, height: 6) }
            if let systemImage { Image(systemName: systemImage).font(.system(size: 10, weight: .bold)) }
            Text(text).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 10)
        .frame(height: 24)
        .foregroundStyle(solid ? .white : color)
        .background(solid ? color : color.opacity(0.18), in: Capsule())
        .fixedSize()
    }
}

/// A track pill in the track's own colour.
struct TrackChip: View {
    let name: String?
    let hex: String?

    var body: some View {
        Chip(text: name ?? "Workout", color: Color(hex: hex), dot: true)
    }
}

/// Small uppercase label above a title or section.
struct Eyebrow: View {
    let text: String
    var color: Color = FC.label2

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.bold))
            .tracking(1.2)
            .foregroundStyle(color)
    }
}

/// The large-title header used at the top of root screens.
struct ScreenHeader<Trailing: View>: View {
    var eyebrow: String?
    let title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                if let eyebrow {
                    Text(eyebrow.uppercased()).font(.footnote.weight(.semibold)).foregroundStyle(FC.label2)
                }
                Text(title).font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, 4)
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(eyebrow: String? = nil, title: String) {
        self.init(eyebrow: eyebrow, title: title) { EmptyView() }
    }
}

struct GroupTitle: View {
    let text: String

    var body: some View {
        Text(text).font(.title3.weight(.semibold)).padding(.horizontal, 4).accessibilityAddTraits(.isHeader)
    }
}

struct ListHeader: View {
    let text: String

    var body: some View {
        Text(text.uppercased()).font(.footnote.weight(.semibold)).foregroundStyle(FC.label2).padding(.horizontal, 16)
    }
}

struct AppMark: View {
    var size: CGFloat = 32

    var body: some View {
        Text("F")
            .font(.system(size: size * 0.6, weight: .black).italic())
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                LinearGradient(colors: [Color(hex: "#FF4B4E"), Color(hex: "#C8102E")], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

struct Wordmark: View {
    var size: CGFloat = 18

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: size * 0.35) {
            Text("FURY CO.").font(.system(size: size, weight: .black).italic())
            Text("ATHLETICS").font(.system(size: size * 0.5, weight: .bold)).tracking(size * 0.12).foregroundStyle(FC.red)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Fury Co. Athletics")
    }
}

// MARK: Lists

/// A grouped list card whose rows are separated by hairlines.
struct ListGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(FC.bg2, in: RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
    }
}

struct ListRow: View {
    var systemImage: String?
    var iconColor: Color = FC.bg4
    let title: String
    var subtitle: String?
    var value: String?
    var titleColor: Color = .white
    var showChevron = true
    var isLast = false

    var body: some View {
        HStack(spacing: 12) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(iconColor, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body).foregroundStyle(titleColor)
                if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(FC.label2) }
            }
            Spacer(minLength: 8)
            if let value { Text(value).font(.body.monospacedDigit()).foregroundStyle(FC.label2).lineLimit(1) }
            if showChevron { Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(FC.label3) }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .padding(.vertical, subtitle == nil ? 0 : 6)
        .overlay(alignment: .bottom) {
            if !isLast { FC.separator.frame(height: 0.5).padding(.leading, systemImage == nil ? 16 : 58) }
        }
        .contentShape(Rectangle())
    }
}

// MARK: Controls and indicators

/// The pill segmented control from the design system.
struct PillSegmented: View {
    let options: [String]
    @Binding var selection: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                Button {
                    withAnimation(.snappy(duration: 0.2)) { selection = index }
                } label: {
                    Text(option)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .background(index == selection ? Color.white.opacity(0.22) : .clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(index == selection ? .isSelected : [])
            }
        }
        .padding(2)
        .background(FC.fill, in: Capsule())
    }
}

struct CapacityBar: View {
    let booked: Int
    let capacity: Int

    var body: some View {
        let full = booked >= capacity
        HStack(spacing: 8) {
            GeometryReader { proxy in
                Capsule().fill(FC.fill)
                    .overlay(alignment: .leading) {
                        Capsule().fill(full ? FC.orange : Color.white.opacity(0.8))
                            .frame(width: proxy.size.width * CGFloat(min(Double(booked) / Double(max(capacity, 1)), 1)))
                    }
            }
            .frame(width: 64, height: 4)
            Text("\(booked)/\(capacity)").font(.footnote.monospacedDigit()).foregroundStyle(full ? FC.orange : FC.label2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(booked) of \(capacity) places taken")
    }
}

struct Ring<Center: View>: View {
    let progress: Double
    var size: CGFloat = 64
    var lineWidth: CGFloat = 7
    var color: Color = FC.red
    @ViewBuilder var center: Center

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.22), lineWidth: lineWidth)
            Circle().trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            center
        }
        .frame(width: size, height: size)
    }
}

/// A small trend line with a filled area and a dot on the latest value.
struct Sparkline: View {
    let values: [Double]
    var color: Color = FC.red

    var body: some View {
        GeometryReader { proxy in
            let points = Self.points(values, in: proxy.size)
            ZStack {
                if points.count > 1 {
                    Path { path in
                        path.move(to: CGPoint(x: points[0].x, y: proxy.size.height))
                        points.forEach { path.addLine(to: $0) }
                        path.addLine(to: CGPoint(x: points[points.count - 1].x, y: proxy.size.height))
                        path.closeSubpath()
                    }
                    .fill(color.opacity(0.14))
                    Path { path in
                        path.move(to: points[0])
                        points.dropFirst().forEach { path.addLine(to: $0) }
                    }
                    .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                }
                if let last = points.last {
                    Circle().fill(color).frame(width: 9, height: 9).overlay(Circle().stroke(.black, lineWidth: 2)).position(last)
                }
            }
        }
        .accessibilityHidden(true)
    }

    static func points(_ values: [Double], in size: CGSize) -> [CGPoint] {
        guard !values.isEmpty else { return [] }
        let low = values.min() ?? 0, high = values.max() ?? 1
        let span = max(high - low, 0.0001)
        let inset: CGFloat = 6
        return values.enumerated().map { index, value in
            let x = values.count == 1 ? size.width - inset : inset + CGFloat(index) * (size.width - 2 * inset) / CGFloat(values.count - 1)
            let y = size.height - inset - CGFloat((value - low) / span) * (size.height - 2 * inset)
            return CGPoint(x: x, y: y)
        }
    }
}

/// Weekly bars; the latest week is highlighted.
struct MiniBars: View {
    let values: [Int]

    var body: some View {
        let peak = max(values.max() ?? 1, 1)
        HStack(alignment: .bottom, spacing: 6) {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(index == values.count - 1 ? FC.red : Color(red: 120 / 255, green: 120 / 255, blue: 128 / 255).opacity(0.32))
                    .frame(height: max(4, CGFloat(value) / CGFloat(peak) * 44))
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 44, alignment: .bottom)
        .accessibilityHidden(true)
    }
}

/// An inline message for something that went wrong, announced to VoiceOver.
struct ErrorText: View {
    let message: String?

    var body: some View {
        if let message {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(FC.orange)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A text field styled as a design-system field.
struct FCField: View {
    let placeholder: String
    @Binding var text: String
    var systemImage: String?
    var secure = false

    var body: some View {
        HStack(spacing: 10) {
            if let systemImage { Image(systemName: systemImage).foregroundStyle(FC.label2) }
            if secure {
                SecureField(placeholder, text: $text)
            } else {
                TextField(placeholder, text: $text)
            }
        }
        .font(.body)
        .padding(.horizontal, 16)
        .frame(height: 52)
        .background(FC.bg2, in: RoundedRectangle(cornerRadius: FC.fieldRadius, style: .continuous))
    }
}

// MARK: Layout helpers

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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(FC.bg.ignoresSafeArea())
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
    /// The app's black page background behind scrolling content.
    func screenBackground() -> some View {
        scrollContentBackground(.hidden).background(FC.bg.ignoresSafeArea())
    }

    /// Design-system sheet: tall rounded corners over a blurred dark material.
    func fcSheet(height: CGFloat) -> some View {
        presentationDetents([.height(height)])
            .presentationCornerRadius(FC.sheetRadius)
            .presentationBackground(.ultraThinMaterial)
            .presentationDragIndicator(.visible)
    }

    /// A sticky call-to-action area that fades the content beneath it into black.
    func bottomBar<Bar: View>(@ViewBuilder _ bar: () -> Bar) -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 10) { bar() }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 8)
                .background(LinearGradient(colors: [.black.opacity(0), .black, .black], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
        }
    }
}
