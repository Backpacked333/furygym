import Foundation

/// Numbers shown on the workout-complete, progress and lift-history screens.
public enum TrainingMath {
    /// Epley estimate: a single is its own max; otherwise load × (1 + reps / 30).
    public static func estimatedOneRepMax(load: Double, reps: Int?) -> Double {
        guard let reps, reps > 1 else { return load }
        return load * (1 + Double(min(reps, 20)) / 30)
    }

    /// Total load moved: Σ load × reps × sets, in whatever unit the entries were logged in.
    public static func volume(of entries: [LogEntryPayload]) -> Double {
        entries.reduce(0) { total, entry in
            guard let load = entry.load, let reps = entry.reps else { return total }
            return total + load * Double(reps) * Double(max(entry.sets ?? 1, 1))
        }
    }

    /// Rounds a converted load to the nearest half unit, the way plates add up.
    public static func displayLoad(kilograms: Double, unit: LoadUnit) -> Double {
        (unit.fromKilograms(kilograms) * 2).rounded() / 2
    }
}

/// The most recent time an exercise was logged, for the "Last: 255 × 5" hint while logging.
public struct LastPerformance: Equatable, Sendable {
    public let loadKg: Double
    public let reps: Int?
    public let performedOn: DayDate

    /// Heaviest set of the latest day each exercise was logged.
    public static func byExercise(_ samples: [LiftSample]) -> [UUID: LastPerformance] {
        var result: [UUID: LastPerformance] = [:]
        for sample in samples {
            let current = result[sample.exerciseId]
            if current == nil || sample.performedOn > current!.performedOn
                || (sample.performedOn == current!.performedOn && sample.loadKg > current!.loadKg) {
                result[sample.exerciseId] = LastPerformance(loadKg: sample.loadKg, reps: sample.reps, performedOn: sample.performedOn)
            }
        }
        return result
    }

    public func label(unit: LoadUnit) -> String {
        let load = Format.number(TrainingMath.displayLoad(kilograms: loadKg, unit: unit))
        return reps.map { "\(load) × \($0)" } ?? "\(load) \(unit.rawValue)"
    }
}

/// One lift's record with how it has moved, for the Progress list and its sparkline.
public struct LiftTrend: Equatable, Sendable, Identifiable {
    public let exerciseId: UUID
    public let name: String
    public let reps: Int?
    /// Best load at this rep count, in kilograms.
    public let bestKg: Double
    /// Improvement over the previous best at this rep count; nil when there is only one session.
    public let deltaKg: Double?
    /// Estimated 1RM per session day, oldest first.
    public let series: [Point]

    public struct Point: Equatable, Sendable {
        public let date: DayDate
        public let estimatedMaxKg: Double
    }

    public var id: String { "\(exerciseId.uuidString)|\(reps ?? 0)" }
    public var title: String { reps.map { "\(name) \($0)RM" } ?? name }

    public static func build(records: [PersonalRecord], samples: [LiftSample]) -> [LiftTrend] {
        let byExercise = Dictionary(grouping: samples, by: \.exerciseId)
        // One row per exercise: the record at the rep count with the highest estimated max.
        let best = Dictionary(grouping: records, by: \.exerciseId).compactMap { _, rows in
            rows.max { TrainingMath.estimatedOneRepMax(load: $0.loadKg, reps: $0.reps) < TrainingMath.estimatedOneRepMax(load: $1.loadKg, reps: $1.reps) }
        }
        return best.map { record in
            let all = byExercise[record.exerciseId] ?? []
            let sameReps = all.filter { $0.reps == record.reps && $0.performedOn < record.performedOn }
            let previous = sameReps.map(\.loadKg).max()
            return LiftTrend(
                exerciseId: record.exerciseId, name: record.exerciseName, reps: record.reps, bestKg: record.loadKg,
                deltaKg: previous.map { record.loadKg - $0 },
                series: series(for: all)
            )
        }
        .sorted { $0.name < $1.name }
    }

    /// Best estimated 1RM on each day the exercise was trained.
    public static func series(for samples: [LiftSample]) -> [Point] {
        var best: [DayDate: Double] = [:]
        for sample in samples {
            let estimate = TrainingMath.estimatedOneRepMax(load: sample.loadKg, reps: sample.reps)
            best[sample.performedOn] = max(best[sample.performedOn] ?? 0, estimate)
        }
        return best.keys.sorted().map { Point(date: $0, estimatedMaxKg: best[$0]!) }
    }
}

public enum WeeklyActivity {
    /// Sessions logged in each of the last `weeks` weeks (Monday-based), oldest first.
    public static func counts(loggedDays: [DayDate], weeks: Int, today: DayDate) -> [Int] {
        let thisWeek = today.startOfWeek
        var counts = Array(repeating: 0, count: max(weeks, 1))
        for day in loggedDays {
            let weeksAgo = day.startOfWeek.days(until: thisWeek) / 7
            if weeksAgo >= 0 && weeksAgo < counts.count { counts[counts.count - 1 - weeksAgo] += 1 }
        }
        return counts
    }

    /// Consecutive weeks with at least one logged session, ending this week (or last week if this
    /// week has nothing yet).
    public static func weekStreak(loggedDays: [DayDate], today: DayDate) -> Int {
        let weeks = Set(loggedDays.map(\.startOfWeek))
        var cursor = weeks.contains(today.startOfWeek) ? today.startOfWeek : today.startOfWeek.adding(days: -7)
        var streak = 0
        while weeks.contains(cursor) {
            streak += 1
            cursor = cursor.adding(days: -7)
        }
        return streak
    }
}

/// The rotating code behind the check-in QR. The app shows `payload`; the front desk scans it.
public enum CheckInCode {
    public static let period: TimeInterval = 30

    public static func counter(at date: Date) -> Int {
        Int((date.timeIntervalSince1970 / period).rounded(.down))
    }

    /// Seconds until the current code is replaced.
    public static func secondsRemaining(at date: Date) -> Int {
        Int(period) - Int(date.timeIntervalSince1970.truncatingRemainder(dividingBy: period))
    }

    /// `code` is the first ten hex characters of HMAC-SHA256(secret, counter).
    public static func payload(userID: UUID, code: String) -> String {
        "FC1:\(userID.uuidString.lowercased()):\(code)"
    }
}

/// Progress toward the gym's attendance milestone.
public struct Milestone: Equatable, Sendable {
    public let visits: Int
    public let every: Int

    public init(visits: Int, every: Int) {
        self.visits = max(visits, 0)
        self.every = max(every, 1)
    }

    /// The next milestone count (20, 40, 60…).
    public var target: Int { (visits / every + 1) * every }
    public var remaining: Int { target - visits }
    public var progressInCycle: Int { visits % every }
    public var fraction: Double { Double(progressInCycle) / Double(every) }
}
