import Foundation

/// A calendar date with no time or timezone, matching Postgres `date` ("2026-11-10").
///
/// Workout dates, program start dates and expiry dates are days on the gym's calendar. Keeping them
/// out of `Date` avoids the classic bug where a date shifts by one when the phone is in another zone.
public struct DayDate: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// Parses "yyyy-MM-dd". Returns nil for anything else, including impossible dates.
    public init?(_ string: String) {
        let parts = string.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), d >= 1, d <= DayDate.daysIn(month: m, year: y)
        else { return nil }
        self.init(year: y, month: m, day: d)
    }

    /// The calendar date of an instant, as seen in a timezone (normally the gym's).
    public init(_ date: Date, in timeZone: TimeZone) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        self.init(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1)
    }

    public static func today(in timeZone: TimeZone, now: Date = Date()) -> DayDate {
        DayDate(now, in: timeZone)
    }

    public var description: String {
        let y = String(year)
        return "\(String(repeating: "0", count: max(0, 4 - y.count)))\(y)-\(month < 10 ? "0" : "")\(month)-\(day < 10 ? "0" : "")\(day)"
    }

    // MARK: Codable — a bare string, exactly as PostgREST sends it

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        // Accept a full timestamp too and keep its date part.
        guard let value = DayDate(String(raw.prefix(10))) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not a calendar date: \(raw)")
        }
        self = value
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(description)
    }

    // MARK: Arithmetic — integer day numbers, no Calendar or timezone involved

    /// Days since 1970-01-01 in the proleptic Gregorian calendar.
    public var dayNumber: Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    public init(dayNumber: Int) {
        let z = dayNumber + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        self.init(year: yoe + era * 400 + (m <= 2 ? 1 : 0), month: m, day: d)
    }

    public func adding(days: Int) -> DayDate {
        DayDate(dayNumber: dayNumber + days)
    }

    public func days(until other: DayDate) -> Int {
        other.dayNumber - dayNumber
    }

    /// 0 = Sunday … 6 = Saturday, matching Postgres `extract(dow)`.
    public var weekday: Int {
        let n = (dayNumber + 4) % 7 // 1970-01-01 was a Thursday
        return n < 0 ? n + 7 : n
    }

    /// The Monday on or before this date.
    public var startOfWeek: DayDate {
        adding(days: weekday == 0 ? -6 : 1 - weekday)
    }

    public static func < (lhs: DayDate, rhs: DayDate) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }

    /// Noon on this day in a timezone — a safe instant to hand to date formatters.
    public func noon(in timeZone: TimeZone) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) ?? Date(timeIntervalSince1970: 0)
    }

    static func daysIn(month: Int, year: Int) -> Int {
        switch month {
        case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }
}
