import Foundation

/// What the button on a class row should do, given what the server reported and the gym's rules.
public enum BookingAction: Equatable, Sendable {
    case book
    case joinWaitlist
    /// `late` means the free-cancellation window has closed and a class credit will not come back.
    case cancel(late: Bool)
    case leaveWaitlist(position: Int?)
    case unavailable(String)

    public var title: String {
        switch self {
        case .book: return "Book"
        case .joinWaitlist: return "Join waitlist"
        case .cancel: return "Cancel booking"
        case .leaveWaitlist: return "Leave waitlist"
        case .unavailable(let reason): return reason
        }
    }
}

public enum ClassBooking {
    public static func action(for session: ClassSession, now: Date, cancelCutoffMinutes: Int, bookingWindowDays: Int) -> BookingAction {
        if session.status == "cancelled" { return .unavailable("Cancelled") }

        switch session.myBookingStatus {
        case .attended: return .unavailable("Attended")
        case .noShow: return .unavailable("Missed")
        case .booked:
            if now >= session.startsAt { return .unavailable("In progress") }
            let cutoff = session.startsAt.addingTimeInterval(-Double(cancelCutoffMinutes) * 60)
            return .cancel(late: now > cutoff)
        case .waitlisted:
            if now >= session.startsAt { return .unavailable("Started") }
            return .leaveWaitlist(position: session.myWaitlistPosition)
        case .cancelled, .unknown, .none:
            break
        }

        if now >= session.startsAt { return .unavailable("Started") }
        if session.startsAt > now.addingTimeInterval(Double(bookingWindowDays) * 86_400) { return .unavailable("Not open yet") }
        return session.bookedCount >= session.capacity ? .joinWaitlist : .book
    }

    public static func spotsLabel(for session: ClassSession) -> String {
        let left = max(session.capacity - session.bookedCount, 0)
        if left == 0 { return session.waitlistCount > 0 ? "Full · \(session.waitlistCount) waiting" : "Full" }
        return left == 1 ? "1 spot left" : "\(left) spots left"
    }
}

/// A summary of what the athlete's memberships currently allow.
public struct Entitlements: Equatable, Sendable {
    public let hasFacilityAccess: Bool
    public let unlimited: Bool
    public let classCredits: Int
    public let pastDue: Bool
    public let frozen: Bool

    /// `today` is the gym's date; a freeze whose resume date has arrived counts as active again,
    /// matching the server.
    public init(memberships: [Membership], now: Date = Date(), today: DayDate? = nil) {
        let live = memberships.filter { membership in
            let thawed = membership.status == .frozen && (membership.frozenUntil.flatMap { until in today.map { until <= $0 } } ?? false)
            return (membership.status == .active || membership.status == .pastDue || thawed) && (membership.endsAt.map { $0 > now } ?? true)
        }
        hasFacilityAccess = !live.isEmpty
        unlimited = live.contains { $0.creditsRemaining == nil }
        classCredits = live.compactMap(\.creditsRemaining).reduce(0, +)
        pastDue = live.contains { $0.status == .pastDue }
        frozen = live.isEmpty && memberships.contains { $0.status == .frozen }
    }

    public var canBookClasses: Bool { unlimited || classCredits > 0 }

    public var headline: String {
        if frozen { return "Membership frozen" }
        if !hasFacilityAccess { return "No active membership" }
        if pastDue { return "Payment problem — update your card" }
        if unlimited { return "Unlimited classes" }
        return classCredits == 1 ? "1 class credit left" : "\(classCredits) class credits left"
    }
}

/// Turns the short error codes raised by the database functions into sentences for the athlete.
public enum ServerMessage {
    private static let messages: [String: String] = [
        "waiver_required": "Please sign the waiver before booking.",
        "no_entitlement": "You need an active membership or class credit to book.",
        "session_started": "This class has already started.",
        "session_cancelled": "This class has been cancelled.",
        "booking_not_open": "Booking has not opened for this class yet.",
        "already_checked_in": "You are already checked in to this class.",
        "not_a_member": "Your gym access is inactive or unavailable. Ask the gym to review your account.",
        "workout_locked": "This workout is not unlocked yet.",
        "program_already_started": "Your program has already started. Ask a coach to move your start date.",
        "start_date_in_past": "Choose today or a later date.",
        "start_date_too_far": "Choose a start date within the next 90 days.",
        "signature_required": "Type your full name to sign.",
        "not_authenticated": "Please sign in again.",
        "forbidden": "You do not have permission to do that.",
        "invalid_workout_item": "This workout changed since you opened it. Go back and open it again.",
    ]

    /// `raw` may be the bare code or a longer message that contains it.
    public static func friendly(_ raw: String, fallback: String = "Something went wrong. Please try again.") -> String {
        if let exact = messages[raw] { return exact }
        if let match = messages.first(where: { raw.contains($0.key) }) { return match.value }
        return fallback
    }

    public static func isKnown(_ raw: String) -> Bool {
        messages.keys.contains { raw.contains($0) }
    }
}

/// Links that bring the athlete back into the app (`furyco://…`).
public enum DeepLink: Equatable, Sendable {
    case checkoutSuccess
    case checkoutCancelled
    case authCallback

    public static let scheme = "furyco"

    public init?(url: URL) {
        guard url.scheme?.lowercased() == DeepLink.scheme else { return nil }
        let path = ([url.host ?? ""] + url.pathComponents.filter { $0 != "/" }).joined(separator: "/").lowercased()
        switch path {
        case "checkout/success": self = .checkoutSuccess
        case "checkout/cancelled": self = .checkoutCancelled
        case "auth-callback": self = .authCallback
        default: return nil
        }
    }
}

public enum PurchaseLinkPolicy {
    /// The "buy on the web" link for digital programs is only shown on the US App Store, and only
    /// while the gym has it switched on. Everywhere else the app shows owned programs without a link.
    public static func showsProgramPurchaseLink(storefrontCountryCode: String?, gymAllows: Bool) -> Bool {
        gymAllows && storefrontCountryCode?.uppercased() == "USA"
    }
}
