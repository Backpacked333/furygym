import Foundation

/// The rules that place an online program on an athlete's own calendar. These mirror the database
/// functions (`my_calendar`, `can_view_workout`) so the app can explain what the server will do —
/// the server remains the authority on what is actually unlocked.
public enum ProgramSchedule {
    /// Day `day` of week `week` lands on `start + (week-1)*7 + (day-1)`.
    public static func date(start: DayDate, week: Int, day: Int) -> DayDate {
        start.adding(days: (week - 1) * 7 + (day - 1))
    }

    public static func isUnlocked(mode: UnlockMode, start: DayDate, week: Int, day: Int, today: DayDate, expiresAt: DayDate?) -> Bool {
        if let expiresAt, today > expiresAt { return false }
        switch mode {
        case .all: return true
        case .weekly: return today >= start.adding(days: (week - 1) * 7)
        case .daily: return today >= date(start: start, week: week, day: day)
        case .unknown: return false
        }
    }

    /// When a locked session opens, for the "Unlocks Monday" label.
    public static func unlockDate(mode: UnlockMode, start: DayDate, week: Int, day: Int) -> DayDate? {
        switch mode {
        case .all: return start
        case .weekly: return start.adding(days: (week - 1) * 7)
        case .daily: return date(start: start, week: week, day: day)
        case .unknown: return nil
        }
    }

    /// 1-based week the athlete is in today; nil before the start date, capped at the final week.
    public static func currentWeek(start: DayDate, today: DayDate, durationWeeks: Int) -> Int? {
        let elapsed = start.days(until: today)
        guard elapsed >= 0 else { return nil }
        return min(elapsed / 7 + 1, max(durationWeeks, 1))
    }

    public enum Phase: Equatable, Sendable {
        case upcoming(daysUntilStart: Int)
        case inProgress(week: Int, of: Int)
        case finished(accessDaysLeft: Int)
        case expired
    }

    public static func phase(start: DayDate, expiresAt: DayDate?, durationWeeks: Int, today: DayDate) -> Phase {
        if today < start { return .upcoming(daysUntilStart: today.days(until: start)) }
        if let expiresAt, today > expiresAt { return .expired }
        let lastDay = start.adding(days: durationWeeks * 7 - 1)
        if today > lastDay { return .finished(accessDaysLeft: expiresAt.map { today.days(until: $0) } ?? 0) }
        return .inProgress(week: currentWeek(start: start, today: today, durationWeeks: durationWeeks) ?? 1, of: durationWeeks)
    }
}

/// How much of the scheduled training was actually logged.
public struct Adherence: Equatable, Sendable {
    public let scheduled: Int
    public let completed: Int

    public var rate: Double { scheduled == 0 ? 0 : Double(completed) / Double(scheduled) }
    public var percent: Int { Int((rate * 100).rounded()) }

    /// Counts sessions dated on or before `today`. Future sessions are not yet "missed".
    public static func through(_ today: DayDate, entries: [CalendarEntry]) -> Adherence {
        let due = entries.filter { $0.calendarDate <= today }
        return Adherence(scheduled: due.count, completed: due.filter(\.isCompleted).count)
    }
}

public enum Streak {
    /// Consecutive days with a logged workout ending today, or yesterday if today is not logged yet.
    public static func current(loggedDays: Set<DayDate>, today: DayDate) -> Int {
        var cursor = loggedDays.contains(today) ? today : today.adding(days: -1)
        var count = 0
        while loggedDays.contains(cursor) {
            count += 1
            cursor = cursor.adding(days: -1)
        }
        return count
    }
}

public enum CalendarGrouping {
    /// Entries grouped by day, days in order, gym workouts before program sessions within a day.
    public static func byDay(_ entries: [CalendarEntry]) -> [(date: DayDate, entries: [CalendarEntry])] {
        let grouped = Dictionary(grouping: entries, by: \.calendarDate)
        return grouped.keys.sorted().map { date in
            let sorted = grouped[date]!.sorted { a, b in
                if a.source != b.source { return a.source == .facility }
                return (a.trackName ?? "", a.title) < (b.trackName ?? "", b.title)
            }
            return (date, sorted)
        }
    }
}

public enum ProgressSeries {
    /// Best load per day for one exercise, oldest first, in the athlete's preferred unit.
    public static func bestLoadPerDay(_ samples: [LiftSample], unit: LoadUnit) -> [(date: DayDate, load: Double)] {
        var best: [DayDate: Double] = [:]
        for sample in samples {
            best[sample.performedOn] = max(best[sample.performedOn] ?? 0, sample.loadKg)
        }
        return best.keys.sorted().map { ($0, (unit.fromKilograms(best[$0]!) * 10).rounded() / 10) }
    }
}
