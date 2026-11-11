import Foundation
import FuryCore
import Observation
import StoreKit
import Supabase

/// Session and account state shared by every screen.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case loading
        case signedOut
        case signedIn
    }

    enum Tab: Hashable {
        case today, classes, train, progress, checkIn
    }

    /// Full-screen flows started from the welcome screen or from prompts inside the app.
    enum Flow: String, Identifiable {
        case joinGym, programs
        var id: String { rawValue }
    }

    /// Which root screen is showing.
    var tab: Tab = .today
    var flow: Flow?
    /// Set on the welcome screen so the right flow opens once the account exists.
    var intentAfterSignIn: Flow?

    let backend: Backend
    let drafts: FileDraftStore

    private(set) var phase: Phase = .loading
    private(set) var gym: Gym?
    private(set) var profile: Profile?
    private(set) var memberships: [Membership] = []
    private(set) var unsignedWaivers: [Waiver] = []
    private(set) var attendance = Attendance(visits: 0, visitsThisMonth: 0)
    private(set) var storefrontCountryCode: String?
    /// Set when the account data could not be loaded, so screens can offer a retry.
    private(set) var loadError: String?
    /// Bumped whenever something changed that other tabs should reload for (a booking, a log, a purchase).
    private(set) var revision = 0
    /// A web page shown in the in-app browser: Stripe Checkout or the billing portal.
    var browserPage: BrowserPage?
    /// Shown once after returning from a successful checkout.
    var purchaseNotice: String?

    init(config: AppConfig, options: SupabaseClientOptions = .init(auth: .init(emitLocalSessionAsInitialSession: true))) {
        backend = Backend(config: config, options: options)
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        drafts = FileDraftStore(directory: support.appendingPathComponent("LogDrafts", isDirectory: true))
        drafts.prune(olderThan: Date().addingTimeInterval(-30 * 86_400))
    }

    var timeZone: TimeZone { gym?.timeZone ?? .current }
    var today: DayDate { DayDate.today(in: timeZone) }
    var entitlements: Entitlements { Entitlements(memberships: memberships, today: today) }
    var milestone: Milestone { Milestone(visits: attendance.visits, every: gym?.milestoneVisits ?? 20) }
    var firstName: String? { profile?.fullName.split(separator: " ").first.map(String.init) }
    var initials: String {
        let parts = (profile?.fullName ?? "").split(separator: " ").prefix(2).compactMap { $0.first }
        return parts.isEmpty ? "?" : String(parts).uppercased()
    }
    var loadUnit: LoadUnit { profile?.loadUnit ?? .lb }
    var needsWaiver: Bool { !unsignedWaivers.isEmpty }

    var showsProgramPurchaseLink: Bool {
        PurchaseLinkPolicy.showsProgramPurchaseLink(storefrontCountryCode: storefrontCountryCode, gymAllows: gym?.iosProgramPurchaseLink ?? false)
    }

    /// Follows the auth session for the life of the app.
    func observeSession() async {
        for await (event, session) in backend.client.auth.authStateChanges {
            switch event {
            case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                if let session, !session.isExpired {
                    if phase != .signedIn {
                        await refreshAccount()
                        phase = .signedIn
                        // Continue what the athlete picked on the welcome screen.
                        if let intent = intentAfterSignIn {
                            intentAfterSignIn = nil
                            if intent == .programs || !entitlements.hasFacilityAccess { flow = intent }
                        }
                    }
                } else if event == .initialSession {
                    phase = .signedOut
                }
            case .signedOut, .userDeleted:
                clear()
                phase = .signedOut
            default:
                break
            }
        }
    }

    /// Loads the gym, profile, memberships and outstanding waivers.
    func refreshAccount() async {
        guard let userID = backend.currentUserID else { return }
        do {
            async let gym = backend.gym()
            async let profile = backend.profile(userID: userID)
            async let memberships = backend.memberships()
            async let waivers = backend.unsignedWaivers()
            async let attendance = backend.attendance()
            let account = try await (gym, profile, memberships, waivers)
            let visits = try? await attendance
            guard backend.currentUserID == userID, !Task.isCancelled else { return }
            self.gym = account.0
            self.profile = account.1
            self.memberships = account.2
            self.unsignedWaivers = account.3
            self.attendance = visits ?? self.attendance
            loadError = nil
        } catch {
            guard backend.currentUserID == userID, !Task.isCancelled else { return }
            loadError = Backend.message(for: error)
        }
        if storefrontCountryCode == nil {
            storefrontCountryCode = await Storefront.current?.countryCode
        }
    }

    func refreshBookingAccess() async throws {
        guard let userID = backend.currentUserID else {
            throw Backend.WebError(message: "Sign in to check your membership.")
        }
        do {
            async let memberships = backend.memberships()
            async let waivers = backend.unsignedWaivers()
            let access = try await (memberships, waivers)
            guard backend.currentUserID == userID, !Task.isCancelled else { throw CancellationError() }
            self.memberships = access.0
            unsignedWaivers = access.1
        } catch {
            if backend.currentUserID == userID, !Task.isCancelled, !(error is CancellationError) {
                memberships = []
            }
            throw error
        }
    }

    // MARK: Payments (handled on the web, returned to through furyco:// links)

    /// Opens Stripe Checkout for a plan or program. Returns a message if it could not be started.
    func startCheckout(_ purchase: Backend.Purchase) async -> String? {
        do {
            browserPage = BrowserPage(url: try await backend.checkoutURL(for: purchase))
            return nil
        } catch {
            return Backend.message(for: error)
        }
    }

    func openBillingPortal() async -> String? {
        do {
            browserPage = BrowserPage(url: try await backend.billingPortalURL())
            return nil
        } catch {
            return Backend.message(for: error)
        }
    }

    /// Handles `furyco://` links: closes the browser and picks up whatever was bought.
    func handle(url: URL) {
        guard let link = DeepLink(url: url) else { return }
        browserPage = nil
        switch link {
        case .checkoutSuccess:
            purchaseNotice = "Payment received. Your access is being switched on."
            Task { await refreshAfterPurchase() }
        case .checkoutCancelled, .authCallback:
            break
        }
    }

    /// The payment is confirmed to our server by Stripe a moment after the athlete returns, so
    /// look again a few times rather than showing stale access.
    func refreshAfterPurchase() async {
        for delay in [0.0, 2.0, 4.0, 8.0] {
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            await refreshAccount()
            didChange()
        }
    }

    /// Call after anything that changes what other screens show.
    func didChange() {
        revision += 1
    }

    func signOut() async {
        await backend.signOut()
    }

    private func clear() {
        profile = nil
        tab = .today
        flow = nil
        attendance = Attendance(visits: 0, visitsThisMonth: 0)
        memberships = []
        unsignedWaivers = []
        loadError = nil
    }
}

struct BrowserPage: Identifiable {
    let id = UUID()
    let url: URL
}
