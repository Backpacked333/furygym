import Foundation
import FuryCore

/// Date and time labels, always in the gym's timezone so "6:00 AM class" means the same thing
/// wherever the athlete's phone happens to be.
enum DateText {
    private static func formatter(_ format: String, _ timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(format)
        return formatter
    }

    /// "Tue, Nov 10"
    static func day(_ date: DayDate, in timeZone: TimeZone) -> String {
        formatter("EEEMMMd", timeZone).string(from: date.noon(in: timeZone))
    }

    /// "Tuesday, November 10"
    static func longDay(_ date: DayDate, in timeZone: TimeZone) -> String {
        formatter("EEEEMMMMd", timeZone).string(from: date.noon(in: timeZone))
    }

    /// "Today", "Tomorrow", "Yesterday" or "Tue, Nov 10"
    static func relativeDay(_ date: DayDate, today: DayDate, in timeZone: TimeZone) -> String {
        switch today.days(until: date) {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        default: return day(date, in: timeZone)
        }
    }

    /// "T" / "10" for the week strip
    static func weekdayInitial(_ date: DayDate, in timeZone: TimeZone) -> String {
        formatter("EEEEE", timeZone).string(from: date.noon(in: timeZone))
    }

    /// "6:00 AM"
    static func time(_ date: Date, in timeZone: TimeZone) -> String {
        formatter("jmm", timeZone).string(from: date)
    }

    /// "Nov 10, 2026"
    static func date(_ date: Date, in timeZone: TimeZone) -> String {
        formatter("yMMMd", timeZone).string(from: date)
    }
}
