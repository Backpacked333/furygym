import XCTest
@testable import FuryCore

private let d = { (s: String) in DayDate(s)! }
private func uuid(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", n))! }

final class TrainingMathTests: XCTestCase {
    func testEstimatedOneRepMax() {
        XCTAssertEqual(TrainingMath.estimatedOneRepMax(load: 405, reps: 1), 405)
        XCTAssertEqual(TrainingMath.estimatedOneRepMax(load: 405, reps: nil), 405)
        XCTAssertEqual(TrainingMath.estimatedOneRepMax(load: 265, reps: 5), 309.17, accuracy: 0.01)
        XCTAssertEqual(TrainingMath.estimatedOneRepMax(load: 100, reps: 30), TrainingMath.estimatedOneRepMax(load: 100, reps: 20), "very high reps are capped rather than extrapolated")
    }

    func testVolumeCountsLoadTimesRepsTimesSets() {
        let entries: [LogEntryPayload] = [
            LogEntryPayload(workoutItemId: uuid(1), setIndex: 1, load: 225, reps: 5),
            LogEntryPayload(workoutItemId: uuid(1), setIndex: 2, load: 245, reps: 5),
            LogEntryPayload(workoutItemId: uuid(2), setIndex: 1, load: 185, sets: 4, reps: 8),
            LogEntryPayload(workoutItemId: uuid(3), setIndex: 1, timeSeconds: 708), // no load: not volume
            LogEntryPayload(workoutItemId: uuid(4), setIndex: 1, load: 45), // load without reps (a ruck): not volume
        ]
        let expected: Double = 1125 + 1225 + 5920 // 225×5 + 245×5 + 185×8×4
        XCTAssertEqual(TrainingMath.volume(of: entries), expected)
        XCTAssertEqual(TrainingMath.displayLoad(kilograms: 120.2, unit: .lb), 265)
        XCTAssertEqual(TrainingMath.displayLoad(kilograms: 102.5, unit: .kg), 102.5)
    }

    func testLastPerformanceIsTheHeaviestSetOfTheLatestDay() {
        let squat = uuid(101), press = uuid(102)
        let samples = [
            LiftSample(exerciseId: squat, loadKg: 100, reps: 5, performedOn: d("2026-10-13")),
            LiftSample(exerciseId: squat, loadKg: 115, reps: 5, performedOn: d("2026-11-10")),
            LiftSample(exerciseId: squat, loadKg: 120, reps: 5, performedOn: d("2026-11-10")),
            LiftSample(exerciseId: squat, loadKg: 130, reps: 1, performedOn: d("2026-10-27")),
            LiftSample(exerciseId: press, loadKg: 60, reps: nil, performedOn: d("2026-11-01")),
        ]
        let last = LastPerformance.byExercise(samples)
        XCTAssertEqual(last[squat], LastPerformance(loadKg: 120, reps: 5, performedOn: d("2026-11-10")))
        XCTAssertEqual(last[squat]?.label(unit: .kg), "120 × 5")
        XCTAssertEqual(last[squat]?.label(unit: .lb), "264.5 × 5")
        XCTAssertEqual(last[press]?.label(unit: .kg), "60 kg")
        XCTAssertNil(last[uuid(999)])
    }

    func testLiftTrendsShowTheRecordItsGainAndASeries() {
        let squat = uuid(101), deadlift = uuid(103)
        let samples = [
            LiftSample(exerciseId: squat, loadKg: 110, reps: 5, performedOn: d("2026-10-13")),
            LiftSample(exerciseId: squat, loadKg: 115, reps: 5, performedOn: d("2026-10-27")),
            LiftSample(exerciseId: squat, loadKg: 105, reps: 5, performedOn: d("2026-10-27")),
            LiftSample(exerciseId: squat, loadKg: 120, reps: 5, performedOn: d("2026-11-10")),
            LiftSample(exerciseId: deadlift, loadKg: 180, reps: 1, performedOn: d("2026-11-02")),
        ]
        let records = [
            PersonalRecord(exerciseId: squat, exerciseName: "Back Squat", reps: 5, load: 120, loadUnit: "kg", loadKg: 120, performedOn: d("2026-11-10")),
            PersonalRecord(exerciseId: squat, exerciseName: "Back Squat", reps: 8, load: 80, loadUnit: "kg", loadKg: 80, performedOn: d("2026-09-01")),
            PersonalRecord(exerciseId: deadlift, exerciseName: "Deadlift", reps: 1, load: 180, loadUnit: "kg", loadKg: 180, performedOn: d("2026-11-02")),
        ]
        let trends = LiftTrend.build(records: records, samples: samples)
        XCTAssertEqual(trends.map(\.title), ["Back Squat 5RM", "Deadlift 1RM"], "one row per exercise, at its strongest rep count")
        XCTAssertEqual(trends[0].bestKg, 120)
        XCTAssertEqual(trends[0].deltaKg, 5, "gain over the previous best at the same rep count")
        XCTAssertEqual(trends[0].series.map(\.date), [d("2026-10-13"), d("2026-10-27"), d("2026-11-10")])
        XCTAssertEqual(trends[0].series[1].estimatedMaxKg, 134.17, accuracy: 0.01, "best set of the day")
        XCTAssertNil(trends[1].deltaKg, "a first session has nothing to compare against")
        XCTAssertEqual(Set(trends.map(\.id)).count, 2)
    }

    func testWeeklyActivityAndWeekStreak() {
        let today = d("2026-11-10") // Tuesday; the week starts Mon Nov 9
        let days = [d("2026-11-09"), d("2026-11-10"), d("2026-11-03"), d("2026-10-28"), d("2026-10-12"), d("2026-08-01")]
        XCTAssertEqual(WeeklyActivity.counts(loggedDays: days, weeks: 5, today: today), [1, 0, 1, 1, 2], "oldest week first; older days fall outside")
        XCTAssertEqual(WeeklyActivity.weekStreak(loggedDays: days, today: today), 3)
        // nothing logged yet this week: last week still counts
        XCTAssertEqual(WeeklyActivity.weekStreak(loggedDays: [d("2026-11-03"), d("2026-10-28")], today: today), 2)
        XCTAssertEqual(WeeklyActivity.weekStreak(loggedDays: [d("2026-10-20")], today: today), 0)
        XCTAssertEqual(WeeklyActivity.counts(loggedDays: [], weeks: 3, today: today), [0, 0, 0])
    }

    func testCheckInCodeWindowsAndPayload() {
        let start = Date(timeIntervalSince1970: 1_800_000_000) // a multiple of 30
        XCTAssertEqual(CheckInCode.counter(at: start), 60_000_000)
        XCTAssertEqual(CheckInCode.counter(at: start.addingTimeInterval(29.9)), 60_000_000)
        XCTAssertEqual(CheckInCode.counter(at: start.addingTimeInterval(30)), 60_000_001)
        XCTAssertEqual(CheckInCode.secondsRemaining(at: start), 30)
        XCTAssertEqual(CheckInCode.secondsRemaining(at: start.addingTimeInterval(12)), 18)
        XCTAssertEqual(CheckInCode.secondsRemaining(at: start.addingTimeInterval(29.5)), 1)
        XCTAssertEqual(CheckInCode.payload(userID: UUID(uuidString: "0A0B0C0D-0000-4000-8000-000000000011")!, code: "a1b2c3d4e5"), "FC1:0a0b0c0d-0000-4000-8000-000000000011:a1b2c3d4e5")
    }

    func testMilestoneProgress() {
        let m = Milestone(visits: 14, every: 20)
        XCTAssertEqual(m.target, 20)
        XCTAssertEqual(m.remaining, 6)
        XCTAssertEqual(m.fraction, 0.7, accuracy: 0.001)
        XCTAssertEqual(Milestone(visits: 20, every: 20).target, 40, "reaching a milestone starts the next one")
        XCTAssertEqual(Milestone(visits: 47, every: 20).progressInCycle, 7)
        XCTAssertEqual(Milestone(visits: 3, every: 0).target, 4, "a zero setting cannot divide by zero")
    }

    func testAFreezeEndsOnItsResumeDate() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let frozen = Membership(id: UUID(), status: .frozen, frozenUntil: d("2026-12-01"))
        XCTAssertFalse(Entitlements(memberships: [frozen], now: now, today: d("2026-11-30")).hasFacilityAccess)
        XCTAssertTrue(Entitlements(memberships: [frozen], now: now, today: d("2026-11-30")).frozen)
        XCTAssertTrue(Entitlements(memberships: [frozen], now: now, today: d("2026-12-01")).hasFacilityAccess)
        XCTAssertFalse(Entitlements(memberships: [Membership(id: UUID(), status: .frozen)], now: now, today: d("2026-12-01")).hasFacilityAccess, "an open-ended freeze stays frozen")
        XCTAssertTrue(frozen.isLive)
    }
}
