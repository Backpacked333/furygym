import XCTest
@testable import FuryCore

final class DayDateTests: XCTestCase {
    func testParsesAndPrintsCalendarDates() {
        XCTAssertEqual(DayDate("2026-11-10"), DayDate(year: 2026, month: 11, day: 10))
        XCTAssertEqual(DayDate("2026-11-10")?.description, "2026-11-10")
        XCTAssertEqual(DayDate(year: 987, month: 1, day: 5).description, "0987-01-05")
        XCTAssertEqual(DayDate("2024-02-29")?.day, 29)
        for bad in ["2026-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "2026-1-5", "11/10/2026", "", "2026-11-10T00:00:00"] {
            XCTAssertNil(DayDate(bad), bad)
        }
    }

    func testArithmeticCrossesMonthsYearsAndLeapDays() {
        let d = DayDate("2026-12-30")!
        XCTAssertEqual(d.adding(days: 3).description, "2027-01-02")
        XCTAssertEqual(d.adding(days: -30).description, "2026-11-30")
        XCTAssertEqual(DayDate("2024-02-28")!.adding(days: 1).description, "2024-02-29")
        XCTAssertEqual(DayDate("2024-02-28")!.adding(days: 2).description, "2024-03-01")
        XCTAssertEqual(DayDate("2025-02-28")!.adding(days: 1).description, "2025-03-01")
        XCTAssertEqual(DayDate("2026-01-01")!.days(until: DayDate("2027-01-01")!), 365)
        XCTAssertEqual(DayDate("2026-11-10")!.days(until: DayDate("2026-11-01")!), -9)
        XCTAssertEqual(DayDate(year: 1970, month: 1, day: 1).dayNumber, 0)
        XCTAssertEqual(DayDate(dayNumber: 0).description, "1970-01-01")
        XCTAssertEqual(DayDate(dayNumber: -1).description, "1969-12-31")
        // round-trips across a wide range
        for n in stride(from: -200_000, through: 200_000, by: 997) {
            XCTAssertEqual(DayDate(dayNumber: n).dayNumber, n)
        }
    }

    func testWeekdayMatchesPostgresAndWeeksStartOnMonday() {
        XCTAssertEqual(DayDate("2026-11-10")!.weekday, 2) // Tuesday
        XCTAssertEqual(DayDate("2026-11-15")!.weekday, 0) // Sunday
        XCTAssertEqual(DayDate("1969-12-28")!.weekday, 0) // Sunday, before the epoch
        XCTAssertEqual(DayDate("2026-11-10")!.startOfWeek.description, "2026-11-09")
        XCTAssertEqual(DayDate("2026-11-15")!.startOfWeek.description, "2026-11-09")
        XCTAssertEqual(DayDate("2026-11-09")!.startOfWeek.description, "2026-11-09")
    }

    func testOrdering() {
        XCTAssertLessThan(DayDate("2026-11-09")!, DayDate("2026-11-10")!)
        XCTAssertLessThan(DayDate("2026-10-31")!, DayDate("2026-11-01")!)
        XCTAssertLessThan(DayDate("2025-12-31")!, DayDate("2026-01-01")!)
        XCTAssertEqual([DayDate("2026-03-01")!, DayDate("2025-12-01")!, DayDate("2026-01-15")!].sorted().map(\.description), ["2025-12-01", "2026-01-15", "2026-03-01"])
    }

    func testTheGymsDateNotThePhones() {
        let chicago = TimeZone(identifier: "America/Chicago")!
        let tokyo = TimeZone(identifier: "Asia/Tokyo")!
        // 03:00 UTC on the 11th is still the evening of the 10th in Chicago, and midday on the 11th in Tokyo.
        let instant = Timestamp.parse("2026-11-11T03:00:00Z")!
        XCTAssertEqual(DayDate(instant, in: chicago).description, "2026-11-10")
        XCTAssertEqual(DayDate(instant, in: tokyo).description, "2026-11-11")
        XCTAssertEqual(DayDate(DayDate("2026-11-10")!.noon(in: chicago), in: chicago).description, "2026-11-10")
    }

    func testCodableUsesABareString() throws {
        struct Box: Codable, Equatable { var date: DayDate }
        let decoded = try JSONDecoder().decode(Box.self, from: Data(#"{"date":"2026-11-10"}"#.utf8))
        XCTAssertEqual(decoded.date.description, "2026-11-10")
        XCTAssertEqual(String(data: try JSONEncoder().encode(decoded), encoding: .utf8), #"{"date":"2026-11-10"}"#)
        XCTAssertThrowsError(try JSONDecoder().decode(Box.self, from: Data(#"{"date":"tomorrow"}"#.utf8)))
    }
}

final class TimestampTests: XCTestCase {
    func testParsesEveryShapePostgresProduces() {
        let expected = 1_794_298_551.0 // 2026-11-10 08:15:51 UTC
        XCTAssertEqual(Timestamp.parse("2026-11-10T08:15:51Z")?.timeIntervalSince1970, expected)
        XCTAssertEqual(Timestamp.parse("2026-11-10T08:15:51+00:00")?.timeIntervalSince1970, expected)
        XCTAssertEqual(Timestamp.parse("2026-11-10 08:15:51+00")?.timeIntervalSince1970, expected)
        XCTAssertEqual(Timestamp.parse("2026-11-10T02:15:51-06:00")?.timeIntervalSince1970, expected)
        XCTAssertEqual(Timestamp.parse("2026-11-10T13:45:51+0530")?.timeIntervalSince1970, expected)
        XCTAssertEqual(Timestamp.parse("2026-11-10T08:15:51")?.timeIntervalSince1970, expected)
        XCTAssertEqual(Timestamp.parse("2026-11-10T08:15:51.123456+00:00")!.timeIntervalSince1970, expected + 0.123456, accuracy: 0.000_001)
        XCTAssertEqual(Timestamp.parse("2026-11-10T08:15:51.5Z")!.timeIntervalSince1970, expected + 0.5, accuracy: 0.000_001)
        for bad in ["", "2026-11-10", "not a date at all!!", "2026-11-10T25:00:00Z", "2026-11-10T08:15:51+0", "2026-02-30T08:15:51Z"] {
            XCTAssertNil(Timestamp.parse(bad), bad)
        }
    }

    func testFormatsAsUTC() {
        XCTAssertEqual(Timestamp.format(Date(timeIntervalSince1970: 1_794_298_551)), "2026-11-10T08:15:51Z")
        XCTAssertEqual(Timestamp.format(Date(timeIntervalSince1970: -1)), "1969-12-31T23:59:59Z")
        XCTAssertEqual(Timestamp.parse(Timestamp.format(Date(timeIntervalSince1970: 86_399)))?.timeIntervalSince1970, 86_399)
    }
}
