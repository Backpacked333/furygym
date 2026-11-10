import Foundation

// Value types for the rows the app reads. Property names are the camelCase form of the database
// columns; `JSONCoding.decoder()` does the conversion.

/// Decodes a string-backed enum, mapping values this app version does not know to `.unknown`
/// so a newer backend never breaks an older app.
public protocol UnknownTolerant: RawRepresentable, Codable, CaseIterable, Sendable where RawValue == String {
    static var unknown: Self { get }
}

extension UnknownTolerant {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .unknown
    }
}

public enum Metric: String, UnknownTolerant, Hashable {
    case load, sets, reps, time, distance, pace, splits, rpe, benchmark, comments, unknown

    public var label: String {
        switch self {
        case .load: return "Load"
        case .sets: return "Sets"
        case .reps: return "Reps"
        case .time: return "Time"
        case .distance: return "Distance"
        case .pace: return "Pace"
        case .splits: return "Splits"
        case .rpe: return "RPE"
        case .benchmark: return "Benchmark"
        case .comments: return "Comments"
        case .unknown: return ""
        }
    }
}

public enum BookingStatus: String, UnknownTolerant {
    case booked, waitlisted, cancelled, attended, noShow = "no_show", unknown
}

public enum MembershipStatus: String, UnknownTolerant {
    case active, pastDue = "past_due", frozen, cancelled, expired, unknown
}

public enum PlanKind: String, UnknownTolerant {
    case recurring, classPack = "class_pack", dropIn = "drop_in", intro, unknown
}

public enum UnlockMode: String, UnknownTolerant {
    case weekly, daily, all, unknown
}

public enum EnrollmentStatus: String, UnknownTolerant {
    case active, paused, completed, cancelled, refunded, unknown
}

public enum CalendarSource: String, UnknownTolerant {
    case facility, program, unknown
}

public struct Gym: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var name: String
    public var timezone: String
    public var bookingWindowDays: Int
    public var cancelCutoffMinutes: Int
    public var iosProgramPurchaseLink: Bool
    public var milestoneVisits: Int?
    public var milestoneReward: String?

    public var timeZone: TimeZone { TimeZone(identifier: timezone) ?? TimeZone(identifier: "UTC")! }
}

public struct Profile: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var email: String?
    public var fullName: String
    public var phone: String?
    public var units: String
    public var emergencyContactName: String?
    public var emergencyContactPhone: String?

    public var loadUnit: LoadUnit { LoadUnit(rawValue: units) ?? .lb }
}

/// One row of the athlete's calendar (`my_calendar`): a gym workout or a day of an enrolled program.
public struct CalendarEntry: Codable, Hashable, Sendable, Identifiable {
    public let calendarDate: DayDate
    public let workoutId: UUID
    public let title: String
    public let trackId: UUID?
    public let trackName: String?
    public let trackColor: String?
    public let source: CalendarSource
    public let programId: UUID?
    public let programName: String?
    public let enrollmentId: UUID?
    public let week: Int?
    public let day: Int?
    public let locked: Bool
    public let logId: UUID?

    public var id: String { "\(workoutId.uuidString)|\(enrollmentId?.uuidString ?? "gym")" }
    public var isCompleted: Bool { logId != nil }

    public init(calendarDate: DayDate, workoutId: UUID, title: String, trackId: UUID? = nil, trackName: String? = nil, trackColor: String? = nil,
                source: CalendarSource, programId: UUID? = nil, programName: String? = nil, enrollmentId: UUID? = nil,
                week: Int? = nil, day: Int? = nil, locked: Bool = false, logId: UUID? = nil) {
        self.calendarDate = calendarDate
        self.workoutId = workoutId
        self.title = title
        self.trackId = trackId
        self.trackName = trackName
        self.trackColor = trackColor
        self.source = source
        self.programId = programId
        self.programName = programName
        self.enrollmentId = enrollmentId
        self.week = week
        self.day = day
        self.locked = locked
        self.logId = logId
    }
}

public struct WorkoutItem: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var position: Int
    public var section: String?
    public var title: String
    public var exerciseId: UUID?
    public var prescription: String?
    public var scaling: String?
    public var notes: String?
    public var videoUrl: String?
    public var metrics: [Metric]
    public var benchmarkName: String?

    /// What the coach asked athletes to record, in a stable display order, without unknown values.
    public var recordedMetrics: [Metric] {
        Metric.allCases.filter { $0 != .unknown && $0 != .benchmark && metrics.contains($0) }
    }

    public var isBenchmark: Bool { metrics.contains(.benchmark) }

    public init(id: UUID, position: Int = 1, section: String? = nil, title: String, exerciseId: UUID? = nil, prescription: String? = nil,
                scaling: String? = nil, notes: String? = nil, videoUrl: String? = nil, metrics: [Metric], benchmarkName: String? = nil) {
        self.id = id
        self.position = position
        self.section = section
        self.title = title
        self.exerciseId = exerciseId
        self.prescription = prescription
        self.scaling = scaling
        self.notes = notes
        self.videoUrl = videoUrl
        self.metrics = metrics
        self.benchmarkName = benchmarkName
    }
}

public struct Workout: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var title: String
    public var description: String?
    public var coachNotes: String?
    public var scheduledDate: DayDate?
    public var workoutItems: [WorkoutItem]

    public var items: [WorkoutItem] { workoutItems.sorted { ($0.position, $0.title) < ($1.position, $1.title) } }
}

public struct LogEntry: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var workoutItemId: UUID?
    public var exerciseId: UUID?
    public var benchmarkName: String?
    public var setIndex: Int
    public var load: Double?
    public var loadUnit: String
    public var sets: Int?
    public var reps: Int?
    public var timeSeconds: Double?
    public var distanceM: Double?
    public var paceSeconds: Double?
    public var paceUnit: String?
    public var splits: [Double]?
    public var rpe: Double?
    public var comments: String?
    public var isPr: Bool
}

public struct CoachFeedback: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var body: String
    public var createdAt: Date
}

public struct WorkoutLog: Codable, Hashable, Sendable, Identifiable {
    public struct WorkoutRef: Codable, Hashable, Sendable {
        public var title: String
    }

    public let id: UUID
    public var workoutId: UUID
    public var enrollmentId: UUID?
    public var performedOn: DayDate
    public var notes: String?
    public var rpe: Double?
    public var workouts: WorkoutRef?
    public var workoutLogEntries: [LogEntry]
    public var coachFeedback: [CoachFeedback]

    public var title: String { workouts?.title ?? "Workout" }
    public var entries: [LogEntry] { workoutLogEntries.sorted { $0.setIndex < $1.setIndex } }
    public var prCount: Int { workoutLogEntries.filter(\.isPr).count }
}

public struct ClassSession: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var title: String
    public var startsAt: Date
    public var endsAt: Date
    public var capacity: Int
    public var status: String
    public var trackName: String?
    public var trackColor: String?
    public var coachName: String?
    public var bookedCount: Int
    public var waitlistCount: Int
    public var myBookingId: UUID?
    public var myBookingStatus: BookingStatus?
    public var myWaitlistPosition: Int?
    public var trackId: UUID?

    public var isFull: Bool { bookedCount >= capacity }
    public var durationMinutes: Int { Int((endsAt.timeIntervalSince(startsAt) / 60).rounded()) }

    public init(id: UUID, title: String, startsAt: Date, endsAt: Date, capacity: Int, status: String = "scheduled", trackName: String? = nil,
                trackColor: String? = nil, coachName: String? = nil, bookedCount: Int = 0, waitlistCount: Int = 0, myBookingId: UUID? = nil,
                myBookingStatus: BookingStatus? = nil, myWaitlistPosition: Int? = nil, trackId: UUID? = nil) {
        self.id = id
        self.title = title
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.capacity = capacity
        self.status = status
        self.trackName = trackName
        self.trackColor = trackColor
        self.coachName = coachName
        self.bookedCount = bookedCount
        self.waitlistCount = waitlistCount
        self.myBookingId = myBookingId
        self.myBookingStatus = myBookingStatus
        self.myWaitlistPosition = myWaitlistPosition
        self.trackId = trackId
    }
}

public struct MembershipPlan: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var name: String
    public var description: String?
    public var kind: PlanKind
    public var priceCents: Int
    public var currency: String
    public var billingInterval: String?
    public var classCredits: Int?
    public var durationDays: Int?

    public var priceLabel: String {
        let price = Format.money(cents: priceCents, currency: currency)
        return billingInterval.map { "\(price) / \($0)" } ?? price
    }
}

public struct Membership: Codable, Hashable, Sendable, Identifiable {
    public struct PlanRef: Codable, Hashable, Sendable {
        public var name: String
        public var kind: PlanKind
        public var priceCents: Int?
        public var currency: String?
        public var billingInterval: String?
        public init(name: String, kind: PlanKind, priceCents: Int? = nil, currency: String? = nil, billingInterval: String? = nil) {
            self.name = name
            self.kind = kind
            self.priceCents = priceCents
            self.currency = currency
            self.billingInterval = billingInterval
        }

        public var priceLabel: String? {
            guard let priceCents else { return nil }
            let price = Format.money(cents: priceCents, currency: currency ?? "usd")
            return billingInterval.map { "\(price)/\($0 == "month" ? "mo" : $0)" } ?? price
        }
    }

    public let id: UUID
    public var status: MembershipStatus
    public var currentPeriodEnd: Date?
    public var endsAt: Date?
    public var cancelAtPeriodEnd: Bool
    public var frozenUntil: DayDate?
    public var creditsRemaining: Int?
    public var membershipPlans: PlanRef?
    public var startedAt: Date?
    public var stripeSubscriptionId: String?

    public var planName: String { membershipPlans?.name ?? "Membership" }
    public var isRecurring: Bool { membershipPlans?.kind == .recurring }
    /// Live memberships are the ones the athlete can still act on.
    public var isLive: Bool { status == .active || status == .pastDue || status == .frozen }

    public init(id: UUID, status: MembershipStatus, currentPeriodEnd: Date? = nil, endsAt: Date? = nil, cancelAtPeriodEnd: Bool = false,
                frozenUntil: DayDate? = nil, creditsRemaining: Int? = nil, membershipPlans: PlanRef? = nil) {
        self.id = id
        self.status = status
        self.currentPeriodEnd = currentPeriodEnd
        self.endsAt = endsAt
        self.cancelAtPeriodEnd = cancelAtPeriodEnd
        self.frozenUntil = frozenUntil
        self.creditsRemaining = creditsRemaining
        self.membershipPlans = membershipPlans
    }
}

public struct Program: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var name: String
    public var slug: String
    public var summary: String?
    public var description: String?
    public var durationWeeks: Int
    public var daysPerWeek: Int
    public var priceCents: Int
    public var currency: String
    public var unlockMode: UnlockMode
    public var graceDays: Int
}

public struct Enrollment: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var programId: UUID
    public var startDate: DayDate
    public var expiresAt: DayDate?
    public var status: EnrollmentStatus
    public var programs: Program?

    public init(id: UUID, programId: UUID, startDate: DayDate, expiresAt: DayDate?, status: EnrollmentStatus, programs: Program? = nil) {
        self.id = id
        self.programId = programId
        self.startDate = startDate
        self.expiresAt = expiresAt
        self.status = status
        self.programs = programs
    }
}

public struct Waiver: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var title: String
    public var body: String
    public var version: Int
}

public struct PersonalRecord: Codable, Hashable, Sendable, Identifiable {
    public var exerciseId: UUID
    public var exerciseName: String
    public var reps: Int?
    public var load: Double
    public var loadUnit: String
    public var loadKg: Double
    public var performedOn: DayDate

    public var id: String { "\(exerciseId.uuidString)|\(reps ?? 0)" }
}

public struct BenchmarkResult: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var benchmarkName: String
    public var timeSeconds: Double?
    public var reps: Int?
    public var load: Double?
    public var loadUnit: String
    public var distanceM: Double?
    public var isPr: Bool
    public var performedOn: DayDate
}

/// A logged lift, for the progress chart of one exercise.
public struct LiftSample: Codable, Hashable, Sendable {
    public var exerciseId: UUID
    public var loadKg: Double
    public var reps: Int?
    public var performedOn: DayDate
}

public struct Payment: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public var description: String?
    public var amountCents: Int
    public var refundedCents: Int
    public var currency: String
    public var status: String
    public var paidAt: Date?
    public var createdAt: Date
}

/// What `submit_workout_log` returns.
public struct LogResult: Codable, Hashable, Sendable {
    public struct PR: Codable, Hashable, Sendable {
        public var title: String
        public var loadKg: Double?
        public var reps: Int?
        public var timeSeconds: Double?
    }

    public var logId: UUID
    public var prs: [PR]
}

/// Class attendance totals for the check-in and profile screens.
public struct Attendance: Codable, Hashable, Sendable {
    public var visits: Int
    public var visitsThisMonth: Int

    public init(visits: Int, visitsThisMonth: Int) {
        self.visits = visits
        self.visitsThisMonth = visitsThisMonth
    }
}
