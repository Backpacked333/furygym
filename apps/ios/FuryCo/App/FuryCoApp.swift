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
            .tint(Theme.accent)
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
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.background)
            case .signedOut:
                AuthView()
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

struct MainTabs: View {
    var body: some View {
        TabView {
            TodayView().tabItem { Label("Today", systemImage: "flame.fill") }
            TrainingView().tabItem { Label("Training", systemImage: "calendar") }
            ClassesView().tabItem { Label("Classes", systemImage: "person.3.fill") }
            ProgressScreen().tabItem { Label("Progress", systemImage: "chart.line.uptrend.xyaxis") }
            AccountView().tabItem { Label("Account", systemImage: "person.crop.circle") }
        }
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
        .background(Theme.background)
    }
}
