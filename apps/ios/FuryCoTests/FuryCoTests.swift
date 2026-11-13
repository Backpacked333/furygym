import Foundation
import FuryCore
import Supabase
import XCTest
@testable import FuryCo

/// Checks of the app target itself. The rules and models are tested in FuryCore.
final class FuryCoTests: XCTestCase {
    func testAnUnconfiguredBuildIsDetectedRatherThanCrashing() {
        // The test bundle has none of the connection keys in its Info.plist.
        XCTAssertNil(AppConfig.load(from: Bundle(for: FuryCoTests.self)))
    }

    func testDatesAreShownInTheGymsTimezone() {
        let chicago = TimeZone(identifier: "America/Chicago")!
        let classStart = Timestamp.parse("2026-11-10T12:00:00+00:00")! // 06:00 in Chicago
        XCTAssertTrue(DateText.time(classStart, in: chicago).hasPrefix("6:00"))

        let today = DayDate("2026-11-10")!
        XCTAssertEqual(DateText.relativeDay(today, today: today, in: chicago), "Today")
        XCTAssertEqual(DateText.relativeDay(today.adding(days: 1), today: today, in: chicago), "Tomorrow")
        XCTAssertEqual(DateText.relativeDay(today.adding(days: -1), today: today, in: chicago), "Yesterday")
        XCTAssertTrue(DateText.day(today.adding(days: 3), in: chicago).contains("13"))
    }

    func testCalendarEntriesDescribeWhereTheyComeFrom() {
        let program = CalendarEntry(calendarDate: DayDate("2026-11-10")!, workoutId: UUID(), title: "Ruck", source: .program,
                                    programName: "Selection Prep", enrollmentId: UUID(), week: 2, day: 3)
        XCTAssertEqual(program.subtitle, "Selection Prep — Week 2 · Day 3")
        XCTAssertNotNil(program.route.enrollmentID)

        let gym = CalendarEntry(calendarDate: DayDate("2026-11-10")!, workoutId: UUID(), title: "Squat Day", trackName: "Strength", source: .facility)
        XCTAssertEqual(gym.subtitle, "Strength")
        XCTAssertNil(gym.route.enrollmentID)
    }

    func testServerAndValidationErrorsBecomeReadableMessages() {
        XCTAssertEqual(Backend.message(for: Backend.WebError(message: "Online payment is not switched on yet.")), "Online payment is not switched on yet.")
        XCTAssertEqual(Backend.message(for: LogValidationError(itemTitle: "Back Squat", message: "Load must be a number.")), "Back Squat: Load must be a number.")
        XCTAssertEqual(Backend.message(for: URLError(.notConnectedToInternet)), "No connection. Check your signal and try again.")
    }

    func testAFailedSignInSaysWhy() {
        let unconfirmed = AuthError.api(message: "Email not confirmed", errorCode: .emailNotConfirmed, underlyingData: Data(), underlyingResponse: HTTPURLResponse())
        XCTAssertEqual(Backend.signInMessage(for: unconfirmed), "Confirm your email first: open the link we sent when you signed up.")
        let wrong = AuthError.api(message: "Invalid login credentials", errorCode: .invalidCredentials, underlyingData: Data(), underlyingResponse: HTTPURLResponse())
        XCTAssertEqual(Backend.signInMessage(for: wrong), "That email and password do not match an account.")
        XCTAssertEqual(Backend.signInMessage(for: URLError(.notConnectedToInternet)), "No connection. Check your signal and try again.")
    }
}
