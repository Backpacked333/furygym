import SwiftUI

@main
struct FuryCoApp: App {
    @State private var model: AppModel? = AppConfig.load().map { AppModel(config: $0) }

    var body: some Scene {
        WindowGroup {
            Group {
                if let model {
                    RootView()
                        .environment(model)
                        .task { await model.observeSession() }
                        .onOpenURL { model.handle(url: $0) }
                } else {
                    NotConfiguredView()
                }
            }
            .preferredColorScheme(.dark)
            .tint(FC.red)
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            switch model.phase {
            case .loading:
                ZStack {
                    FC.bg.ignoresSafeArea()
                    AppMark(size: 56)
                }
            case .signedOut:
                WelcomeView()
            case .signedIn:
                MainTabs()
            }
        }
        .sheet(item: $model.browserPage) { page in
            SafariView(url: page.url).ignoresSafeArea()
        }
        .alert("Thank you", isPresented: Binding(get: { model.purchaseNotice != nil }, set: { if !$0 { model.purchaseNotice = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.purchaseNotice ?? "")
        }
    }
}

/// The five root screens. Each keeps its own navigation history while another is showing.
struct MainTabs: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            root(.today) { TodayView() }
            root(.classes) { ClassesView() }
            root(.train) { TrainingView() }
            root(.progress) { ProgressScreen() }
            root(.checkIn) { CheckInView() }

            // Flows sit above the tabs rather than in a modal, so the payment browser (presented from
            // the root) can open on top of them.
            if let flow = model.flow {
                Group {
                    switch flow {
                    case .joinGym: JoinFlowView()
                    case .programs: NavigationStack { ProgramsView(isRootOfFlow: true) }
                    }
                }
                .background(FC.bg.ignoresSafeArea())
                .transition(.move(edge: .bottom))
                .zIndex(1)
            }
        }
        .animation(.snappy(duration: 0.3), value: model.flow)
        .background(FC.bg.ignoresSafeArea())
    }

    private func root<Content: View>(_ tab: AppModel.Tab, @ViewBuilder _ content: () -> Content) -> some View {
        let active = model.tab == tab
        return NavigationStack { content() }
            .opacity(active ? 1 : 0)
            .allowsHitTesting(active)
            .accessibilityHidden(!active)
    }
}

/// The floating glass tab bar with the red check-in button beside it.
struct FloatingTabBar: View {
    @Environment(AppModel.self) private var model

    private let tabs: [(AppModel.Tab, String, String)] = [
        (.today, "Today", "house.fill"),
        (.classes, "Classes", "calendar"),
        (.train, "Train", "dumbbell.fill"),
        (.progress, "Progress", "chart.line.uptrend.xyaxis"),
    ]

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                ForEach(tabs, id: \.1) { tab, title, icon in
                    let active = model.tab == tab
                    Button {
                        model.tab = tab
                    } label: {
                        VStack(spacing: 2) {
                            Image(systemName: icon).font(.system(size: 20, weight: .medium))
                            Text(title).font(.system(size: 10, weight: .semibold))
                        }
                        .foregroundStyle(active ? FC.red : .white)
                        .frame(maxWidth: .infinity, minHeight: 54)
                        .background(active ? Color.white.opacity(0.10) : .clear, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(title)
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
            .padding(4)
            .background(GlassBackground(shape: Capsule()))

            Button {
                model.tab = .checkIn
            } label: {
                Image(systemName: "qrcode")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(model.tab == .checkIn ? .white : FC.redHi)
                    .frame(width: 62, height: 62)
                    .background(model.tab == .checkIn ? FC.redFill : FC.red.opacity(0.20), in: Circle())
                    .overlay(Circle().stroke(FC.red.opacity(0.4), lineWidth: 0.5))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Check in")
        }
        .padding(.horizontal, 21)
        .padding(.top, 20)
        .padding(.bottom, 6)
        .background(LinearGradient(colors: [.black.opacity(0), .black.opacity(0.7)], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }
}

extension View {
    /// Adds the floating tab bar under a root screen's scrolling content.
    func withTabBar() -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) { FloatingTabBar() }
    }
}

/// Shown when the build has no backend configuration — a developer setup problem, not a user one.
struct NotConfiguredView: View {
    var body: some View {
        ContentUnavailableView {
            Label("App not configured", systemImage: "wrench.and.screwdriver")
        } description: {
            Text("Copy Config/Config.example.xcconfig to Config/Config.xcconfig, fill in the Supabase and web URLs, and build again.")
        }
        .background(FC.bg)
    }
}
