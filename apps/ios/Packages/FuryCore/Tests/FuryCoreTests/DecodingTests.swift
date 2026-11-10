import XCTest
@testable import FuryCore

/// Decodes responses captured from the real backend (see apps/ios/scripts/refresh-fixtures.mjs).
/// If the schema or a query changes without the models following, these fail.
final class DecodingTests: XCTestCase {
    private func fixture<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"), "missing fixture \(name)")
        return try JSONCoding.decoder().decode(T.self, from: Data(contentsOf: url))
    }

    func testGymAndProfile() throws {
        let gym = try XCTUnwrap(fixture("gym", as: [Gym].self).first)
        XCTAssertEqual(gym.name, "Fury Co. Athletics")
        XCTAssertEqual(gym.timeZone.identifier, "America/Chicago")
        XCTAssertEqual(gym.bookingWindowDays, 14)
        XCTAssertEqual(gym.cancelCutoffMinutes, 60)
        XCTAssertTrue(gym.iosProgramPurchaseLink)

        let profile = try XCTUnwrap(fixture("profile", as: [Profile].self).first)
        XCTAssertEqual(profile.fullName, "Alex Athlete")
        XCTAssertEqual(profile.loadUnit, .lb)
    }

    func testCalendarMergesGymAndProgramDays() throws {
        let entries: [CalendarEntry] = try fixture("calendar")
        XCTAssertTrue(entries.contains { $0.source == .facility })
        let program = entries.filter { $0.source == .program }
        XCTAssertFalse(program.isEmpty)
        XCTAssertTrue(program.allSatisfy { $0.enrollmentId != nil && $0.week != nil && $0.day != nil && $0.programName == "Selection Prep — 6 Week" })
        // seeded: weeks 1-2 open, later weeks locked; week 1 fully logged
        XCTAssertTrue(program.filter { $0.week! <= 2 }.allSatisfy { !$0.locked })
        XCTAssertTrue(program.filter { $0.week! >= 3 }.allSatisfy(\.locked))
        XCTAssertTrue(program.filter { $0.week == 1 }.allSatisfy(\.isCompleted))
        XCTAssertEqual(Set(entries.map(\.id)).count, entries.count, "ids must be unique for SwiftUI lists")

        // The rule the app uses to explain locking agrees with what the server decided.
        let enrollment = try XCTUnwrap(fixture("enrollments", as: [Enrollment].self).first)
        let today = enrollment.startDate.adding(days: 9) // seeded "started 9 days ago"
        for entry in program {
            let unlocked = ProgramSchedule.isUnlocked(mode: .weekly, start: enrollment.startDate, week: entry.week!, day: entry.day!, today: today, expiresAt: enrollment.expiresAt)
            XCTAssertEqual(unlocked, !entry.locked, "week \(entry.week!) day \(entry.day!)")
            XCTAssertEqual(ProgramSchedule.date(start: enrollment.startDate, week: entry.week!, day: entry.day!), entry.calendarDate)
        }
    }

    func testWorkoutWithCoachConfiguredMetrics() throws {
        let workout = try XCTUnwrap(fixture("workout", as: [Workout].self).first)
        XCTAssertFalse(workout.items.isEmpty)
        XCTAssertNil(workout.scheduledDate, "program workouts are placed by week/day, not a date")
        let item = workout.items[0]
        XCTAssertFalse(item.recordedMetrics.isEmpty)
        XCTAssertFalse(item.recordedMetrics.contains(.unknown))
        XCTAssertNotNil(item.prescription)
    }

    func testLogsWithEntriesAndCoachFeedback() throws {
        let logs: [WorkoutLog] = try fixture("logs")
        XCTAssertGreaterThan(logs.count, 5)
        XCTAssertTrue(logs.contains { !$0.coachFeedback.isEmpty })
        XCTAssertTrue(logs.contains { $0.prCount > 0 })
        let squat = try XCTUnwrap(logs.first { $0.title == "Squat Day" })
        XCTAssertEqual(squat.entries.count, 5)
        XCTAssertEqual(squat.entries.map(\.setIndex), [1, 2, 3, 4, 5])
        XCTAssertEqual(squat.entries[0].loadUnit, "lb")
        XCTAssertEqual(squat.entries[0].reps, 5)
        XCTAssertEqual(squat.rpe, 7.5)
        XCTAssertEqual(Format.summary(of: squat.entries[0]), "235 lb · 5 reps")
        XCTAssertGreaterThan(logs[0].performedOn, logs[logs.count - 1].performedOn)
    }

    func testClassesWithTimestampsAndMyBooking() throws {
        let sessions: [ClassSession] = try fixture("classes")
        XCTAssertEqual(sessions.count, 12)
        let first = sessions[0]
        XCTAssertEqual(first.endsAt.timeIntervalSince(first.startsAt), 3600)
        XCTAssertEqual(first.coachName, "Casey Coach")
        XCTAssertTrue(sessions.contains { $0.myBookingStatus == .attended })
        XCTAssertTrue(sessions.allSatisfy { $0.myWaitlistPosition == nil })
        // 06:00 in Chicago, whatever the phone's own timezone
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Chicago")!
        let six = try XCTUnwrap(sessions.first { $0.title == "Strength 6AM" })
        XCTAssertEqual(calendar.component(.hour, from: six.startsAt), 6)
    }

    func testPlansMembershipsProgramsAndEnrollments() throws {
        let plans: [MembershipPlan] = try fixture("plans")
        XCTAssertEqual(Set(plans.map(\.kind)), [.recurring, .classPack, .dropIn, .intro])
        XCTAssertEqual(plans.first { $0.kind == .recurring }?.priceLabel, "$185.00 / month")
        XCTAssertEqual(plans.first { $0.kind == .classPack }?.classCredits, 10)

        let memberships: [Membership] = try fixture("memberships")
        XCTAssertEqual(memberships.first?.status, .active)
        XCTAssertEqual(memberships.first?.planName, "Unlimited Monthly")
        XCTAssertNotNil(memberships.first?.currentPeriodEnd, "timestamps with microseconds must decode")
        XCTAssertTrue(Entitlements(memberships: memberships).unlimited)

        let programs: [Program] = try fixture("programs")
        XCTAssertEqual(programs.first?.unlockMode, .weekly)
        XCTAssertEqual(programs.first?.durationWeeks, 6)

        let enrollment = try XCTUnwrap(fixture("enrollments", as: [Enrollment].self).first)
        XCTAssertEqual(enrollment.status, .active)
        XCTAssertEqual(enrollment.programs?.name, "Selection Prep — 6 Week")
        XCTAssertEqual(enrollment.expiresAt, enrollment.startDate.adding(days: 6 * 7 - 1 + 14))
    }

    func testWaiversRecordsSamplesPaymentsAndLogResult() throws {
        XCTAssertEqual(try fixture("waivers", as: [Waiver].self).first?.version, 1)

        let records: [PersonalRecord] = try fixture("records")
        let squat = try XCTUnwrap(records.first { $0.exerciseName == "Back Squat" })
        XCTAssertEqual(squat.load, 235)
        XCTAssertEqual(squat.reps, 5)
        XCTAssertEqual(squat.loadKg, 106.59, accuracy: 0.01)

        let samples: [LiftSample] = try fixture("lift_samples")
        let series = ProgressSeries.bestLoadPerDay(samples.filter { $0.exerciseId == squat.exerciseId }, unit: .lb)
        XCTAssertEqual(series.count, 6)
        XCTAssertEqual(series.map(\.load), [185, 195, 205, 215, 225, 235], "a steady build-up, oldest first, converted back to pounds")

        let payments: [Payment] = try fixture("payments")
        XCTAssertTrue(payments.contains { $0.status == "succeeded" && $0.paidAt != nil })
        XCTAssertEqual(payments.first { $0.description == "Selection Prep — 6 Week" }?.amountCents, 14900)

        let result: LogResult = try fixture("log_result")
        XCTAssertEqual(result.prs.count, 1)
        XCTAssertEqual(result.prs[0].title, "Back Squat")
        XCTAssertEqual(result.prs[0].reps, 5)
    }

    func testUnknownEnumValuesFromANewerBackendDoNotBreakDecoding() throws {
        let json = #"[{"id":"7C1F4D0E-1111-4222-8333-444455556666","position":1,"title":"Sled Push","metrics":["load","heart_rate","reps"]}]"#
        let items = try JSONCoding.decoder().decode([WorkoutItem].self, from: Data(json.utf8))
        XCTAssertEqual(items[0].metrics, [.load, .unknown, .reps])
        XCTAssertEqual(items[0].recordedMetrics, [.load, .reps])

        let membership = #"{"id":"7C1F4D0E-1111-4222-8333-444455556666","status":"on_hold","cancel_at_period_end":false}"#
        XCTAssertEqual(try JSONCoding.decoder().decode(Membership.self, from: Data(membership.utf8)).status, .unknown)
    }

    func testLogEntryPayloadUsesTheColumnNamesTheServerExpects() throws {
        let payload = LogEntryPayload(workoutItemId: UUID(uuidString: "7C1F4D0E-1111-4222-8333-444455556666")!, setIndex: 2, load: 102.5, loadUnit: "kg", reps: 5, timeSeconds: 754, distanceM: 4800)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["workout_item_id", "set_index", "load", "load_unit", "reps", "time_seconds", "distance_m"])
        XCTAssertEqual(object["set_index"] as? Int, 2)
        XCTAssertEqual(object["time_seconds"] as? Double, 754)
        // the same keys come out whether or not the encoder also converts to snake_case
        let converted = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONCoding.encoder().encode(payload)) as? [String: Any])
        XCTAssertEqual(Set(converted.keys), Set(object.keys))
    }
}
