import XCTest
@testable import FuryCore

private let d = { (s: String) in DayDate(s)! }
private func uuid(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", n))! }

final class ProgramScheduleTests: XCTestCase {
    let start = d("2026-11-12") // a Thursday: programs start on whatever day the athlete picks

    func testEachAthletesCalendarRunsFromTheirOwnStartDate() {
        XCTAssertEqual(ProgramSchedule.date(start: start, week: 1, day: 1), d("2026-11-12"))
        XCTAssertEqual(ProgramSchedule.date(start: start, week: 1, day: 5), d("2026-11-16"))
        XCTAssertEqual(ProgramSchedule.date(start: start, week: 3, day: 2), d("2026-11-27"))
        XCTAssertEqual(ProgramSchedule.date(start: start, week: 8, day: 7), d("2027-01-06"))
        XCTAssertEqual(ProgramSchedule.date(start: d("2026-12-01"), week: 1, day: 1), d("2026-12-01"))
    }

    func testWeeklyUnlockOpensAWholeWeekOnItsFirstDay() {
        let unlocked = { (week: Int, day: Int, today: String) in
            ProgramSchedule.isUnlocked(mode: .weekly, start: self.start, week: week, day: day, today: d(today), expiresAt: d("2027-01-20"))
        }
        XCTAssertFalse(unlocked(1, 1, "2026-11-11")) // before the start
        XCTAssertTrue(unlocked(1, 1, "2026-11-12"))
        XCTAssertTrue(unlocked(1, 5, "2026-11-12")) // all of week 1 on day one
        XCTAssertFalse(unlocked(2, 1, "2026-11-18"))
        XCTAssertTrue(unlocked(2, 1, "2026-11-19"))
        XCTAssertTrue(unlocked(1, 3, "2026-12-25")) // missed sessions stay available
        XCTAssertTrue(unlocked(8, 5, "2027-01-20")) // last day of access
        XCTAssertFalse(unlocked(1, 1, "2027-01-21")) // expired: nothing is open
    }

    func testDailyAndAllAtOnceModes() {
        XCTAssertFalse(ProgramSchedule.isUnlocked(mode: .daily, start: start, week: 1, day: 3, today: d("2026-11-13"), expiresAt: nil))
        XCTAssertTrue(ProgramSchedule.isUnlocked(mode: .daily, start: start, week: 1, day: 3, today: d("2026-11-14"), expiresAt: nil))
        XCTAssertTrue(ProgramSchedule.isUnlocked(mode: .all, start: start, week: 8, day: 7, today: d("2026-11-01"), expiresAt: nil))
        XCTAssertFalse(ProgramSchedule.isUnlocked(mode: .unknown, start: start, week: 1, day: 1, today: d("2026-12-01"), expiresAt: nil))
        XCTAssertEqual(ProgramSchedule.unlockDate(mode: .weekly, start: start, week: 3, day: 4), d("2026-11-26"))
        XCTAssertEqual(ProgramSchedule.unlockDate(mode: .daily, start: start, week: 3, day: 4), d("2026-11-29"))
    }

    func testPhaseOfAnEnrollment() {
        let expires = d("2027-01-20") // 8 weeks end 2027-01-06, plus 14 days
        let phase = { (today: String) in ProgramSchedule.phase(start: self.start, expiresAt: expires, durationWeeks: 8, today: d(today)) }
        XCTAssertEqual(phase("2026-11-09"), .upcoming(daysUntilStart: 3))
        XCTAssertEqual(phase("2026-11-12"), .inProgress(week: 1, of: 8))
        XCTAssertEqual(phase("2026-11-18"), .inProgress(week: 1, of: 8))
        XCTAssertEqual(phase("2026-11-19"), .inProgress(week: 2, of: 8))
        XCTAssertEqual(phase("2027-01-06"), .inProgress(week: 8, of: 8))
        XCTAssertEqual(phase("2027-01-07"), .finished(accessDaysLeft: 13))
        XCTAssertEqual(phase("2027-01-20"), .finished(accessDaysLeft: 0))
        XCTAssertEqual(phase("2027-01-21"), .expired)
        XCTAssertNil(ProgramSchedule.currentWeek(start: start, today: d("2026-11-11"), durationWeeks: 8))
        XCTAssertEqual(ProgramSchedule.currentWeek(start: start, today: d("2027-03-01"), durationWeeks: 8), 8)
    }

    func testAdherenceCountsOnlySessionsThatAreDue() {
        func entry(_ date: String, logged: Bool) -> CalendarEntry {
            CalendarEntry(calendarDate: d(date), workoutId: UUID(), title: "W", source: .program, logId: logged ? UUID() : nil)
        }
        let entries = [entry("2026-11-08", logged: true), entry("2026-11-09", logged: false), entry("2026-11-10", logged: true), entry("2026-11-11", logged: false), entry("2026-11-12", logged: false)]
        let adherence = Adherence.through(d("2026-11-10"), entries: entries)
        XCTAssertEqual(adherence.scheduled, 3)
        XCTAssertEqual(adherence.completed, 2)
        XCTAssertEqual(adherence.percent, 67)
        XCTAssertEqual(Adherence.through(d("2026-11-01"), entries: entries).percent, 0)
    }

    func testStreakToleratesTodayNotBeingLoggedYet() {
        let days: Set<DayDate> = [d("2026-11-07"), d("2026-11-08"), d("2026-11-09"), d("2026-11-05")]
        XCTAssertEqual(Streak.current(loggedDays: days, today: d("2026-11-10")), 3)
        XCTAssertEqual(Streak.current(loggedDays: days.union([d("2026-11-10")]), today: d("2026-11-10")), 4)
        XCTAssertEqual(Streak.current(loggedDays: days, today: d("2026-11-11")), 0)
        XCTAssertEqual(Streak.current(loggedDays: [], today: d("2026-11-10")), 0)
    }

    func testCalendarGroupsByDayWithGymWorkoutsFirst() {
        let entries = [
            CalendarEntry(calendarDate: d("2026-11-11"), workoutId: uuid(1), title: "Run", source: .program),
            CalendarEntry(calendarDate: d("2026-11-10"), workoutId: uuid(2), title: "Ruck", source: .program),
            CalendarEntry(calendarDate: d("2026-11-10"), workoutId: uuid(3), title: "Squat Day", trackName: "Strength", source: .facility),
            CalendarEntry(calendarDate: d("2026-11-10"), workoutId: uuid(4), title: "Row Intervals", trackName: "Engine", source: .facility),
        ]
        let grouped = CalendarGrouping.byDay(entries)
        XCTAssertEqual(grouped.map(\.date), [d("2026-11-10"), d("2026-11-11")])
        XCTAssertEqual(grouped[0].entries.map(\.title), ["Row Intervals", "Squat Day", "Ruck"])
    }
}

final class LogFormTests: XCTestCase {
    let squat = WorkoutItem(id: uuid(1), position: 1, title: "Back Squat", exerciseId: uuid(101), metrics: [.load, .reps, .rpe])
    let row = WorkoutItem(id: uuid(2), position: 2, title: "5 x 500m Row", metrics: [.time, .splits, .pace, .rpe])
    let ruck = WorkoutItem(id: uuid(3), position: 3, title: "Ruck", metrics: [.load, .distance, .time])
    let bench2k = WorkoutItem(id: uuid(4), position: 4, title: "2k Row", metrics: [.benchmark, .time], benchmarkName: "2k Row")
    let coolDown = WorkoutItem(id: uuid(5), position: 5, title: "Cool down", metrics: [])
    lazy var workout = Workout(id: uuid(9), title: "Test Day", description: nil, coachNotes: nil, scheduledDate: d("2026-11-10"), workoutItems: [ruck, coolDown, squat, bench2k, row])

    func testFormIsBuiltFromWhatTheCoachAskedFor() {
        let draft = LogForm.newDraft(for: workout, enrollmentId: nil, performedOn: d("2026-11-10"), loadUnit: .lb)
        XCTAssertEqual(Set(draft.items.keys), [squat.id, row.id, ruck.id, bench2k.id], "items with nothing to record get no fields")
        XCTAssertEqual(workout.items.map(\.title), ["Back Squat", "5 x 500m Row", "Ruck", "2k Row", "Cool down"], "ordered by position")
        XCTAssertEqual(bench2k.recordedMetrics, [.time], "benchmark marks the item; it is not itself a field")
        XCTAssertTrue(LogForm.allowsMultipleSets(squat))
        XCTAssertFalse(LogForm.allowsMultipleSets(row))
        XCTAssertFalse(LogForm.allowsMultipleSets(bench2k))
        XCTAssertFalse(draft.hasContent)
    }

    func testSubmissionParsesTypedValuesAndDropsEmptySets() throws {
        var draft = LogForm.newDraft(for: workout, enrollmentId: nil, performedOn: d("2026-11-10"), loadUnit: .lb)
        var s1 = SetDraft(); s1.load = "225"; s1.reps = "5"; s1.rpe = "7"
        var s2 = SetDraft(); s2.load = "235,5"; s2.reps = "5"
        draft.items[squat.id] = [s1, SetDraft(), s2]
        var r = SetDraft(); r.time = "9:12.5"; r.splits = ["1:48", "", "1:51"]; r.pace = "1:50"; r.paceUnit = "500m"
        draft.items[row.id] = [r]
        var k = SetDraft(); k.load = "35"; k.distance = "4"; k.distanceUnit = .mi; k.time = "1:02:03"
        draft.items[ruck.id] = [k]
        draft.notes = "  Felt strong.  "
        draft.rpe = "8.5"
        XCTAssertTrue(draft.hasContent)

        let submission = try LogForm.submission(from: draft, workout: workout).get()
        XCTAssertEqual(submission.notes, "Felt strong.")
        XCTAssertEqual(submission.rpe, 8.5)
        XCTAssertEqual(submission.entries.count, 4)

        let squats = submission.entries.filter { $0.workoutItemId == squat.id }
        XCTAssertEqual(squats.map(\.setIndex), [1, 2], "the empty middle set is skipped and the rest renumbered")
        XCTAssertEqual(squats.map(\.load), [225, 235.5])
        XCTAssertEqual(squats[0].loadUnit, "lb")
        XCTAssertEqual(squats[0].rpe, 7)
        XCTAssertNil(squats[0].timeSeconds)

        let rowed = try XCTUnwrap(submission.entries.first { $0.workoutItemId == row.id })
        XCTAssertEqual(rowed.timeSeconds, 552.5)
        XCTAssertEqual(rowed.splits, [108, 111])
        XCTAssertEqual(rowed.paceSeconds, 110)
        XCTAssertEqual(rowed.paceUnit, "500m")

        let rucked = try XCTUnwrap(submission.entries.first { $0.workoutItemId == ruck.id })
        XCTAssertEqual(rucked.distanceM, 6437.38, "miles are stored as metres")
        XCTAssertEqual(rucked.timeSeconds, 3723)
        XCTAssertEqual(rucked.load, 35)
    }

    func testOnlyFieldsTheCoachConfiguredAreSent() throws {
        var draft = LogForm.newDraft(for: workout, enrollmentId: nil, performedOn: d("2026-11-10"), loadUnit: .kg)
        var s = SetDraft(); s.load = "100"; s.reps = "5"; s.time = "1:00"; s.distance = "400"; s.comments = "ignored: not configured"
        draft.items[squat.id] = [s]
        let entry = try XCTUnwrap(LogForm.submission(from: draft, workout: workout).get().entries.first)
        XCTAssertEqual(entry.load, 100)
        XCTAssertEqual(entry.loadUnit, "kg")
        XCTAssertNil(entry.timeSeconds)
        XCTAssertNil(entry.distanceM)
        XCTAssertNil(entry.comments)
    }

    func testValidationNamesTheItemAndTheProblem() {
        func error(_ edit: (inout LogDraft) -> Void) -> String? {
            var draft = LogForm.newDraft(for: workout, enrollmentId: nil, performedOn: d("2026-11-10"), loadUnit: .lb)
            edit(&draft)
            if case .failure(let failure) = LogForm.submission(from: draft, workout: workout) { return failure.description }
            return nil
        }
        XCTAssertEqual(error { _ in }, "Enter at least one result, or add a note.")
        XCTAssertEqual(error { $0.items[self.squat.id]![0].load = "heavy" }, "Back Squat: Load must be a number.")
        XCTAssertEqual(error { $0.items[self.squat.id]![0].reps = "5.5" }, "Back Squat: Reps must be a whole number.")
        XCTAssertEqual(error { $0.items[self.squat.id]![0].rpe = "11" }, "Back Squat: RPE is a number from 0 to 10.")
        XCTAssertEqual(error { $0.items[self.row.id]![0].time = "9:75" }, "5 x 500m Row: Enter time as mm:ss.")
        XCTAssertEqual(error { $0.items[self.row.id]![0].splits = ["1:50", "fast"] }, "5 x 500m Row: Enter each split as mm:ss.")
        XCTAssertEqual(error { $0.rpe = "twelve" }, "Session RPE is a number from 0 to 10.")
        XCTAssertNil(error { $0.notes = "Travel day — skipped the lifting." }, "a note alone is enough to mark the session done")
    }

    func testAWorkoutWithNothingToRecordCanStillBeMarkedDone() throws {
        let mobility = Workout(id: uuid(8), title: "Mobility", description: nil, coachNotes: nil, scheduledDate: nil, workoutItems: [coolDown])
        let draft = LogForm.newDraft(for: mobility, enrollmentId: uuid(50), performedOn: d("2026-11-10"), loadUnit: .lb)
        XCTAssertTrue(draft.items.isEmpty)
        XCTAssertEqual(try LogForm.submission(from: draft, workout: mobility).get().entries, [])
    }

    func testEditingAnExistingLogRoundTrips() throws {
        let entries = [
            LogEntry(id: uuid(21), workoutItemId: squat.id, exerciseId: uuid(101), benchmarkName: nil, setIndex: 2, load: 102.5, loadUnit: "kg", sets: nil, reps: 5, timeSeconds: nil, distanceM: nil, paceSeconds: nil, paceUnit: nil, splits: nil, rpe: 8, comments: nil, isPr: true),
            LogEntry(id: uuid(20), workoutItemId: squat.id, exerciseId: uuid(101), benchmarkName: nil, setIndex: 1, load: 100, loadUnit: "kg", sets: nil, reps: 5, timeSeconds: nil, distanceM: nil, paceSeconds: nil, paceUnit: nil, splits: nil, rpe: nil, comments: nil, isPr: false),
            LogEntry(id: uuid(22), workoutItemId: bench2k.id, exerciseId: nil, benchmarkName: "2k Row", setIndex: 1, load: nil, loadUnit: "lb", sets: nil, reps: nil, timeSeconds: 472.5, distanceM: nil, paceSeconds: nil, paceUnit: nil, splits: nil, rpe: nil, comments: nil, isPr: true),
        ]
        let log = WorkoutLog(id: uuid(30), workoutId: workout.id, enrollmentId: nil, performedOn: d("2026-11-09"), notes: "Good day", rpe: 8, workouts: nil, workoutLogEntries: entries, coachFeedback: [])
        let draft = LogForm.draft(from: log, workout: workout, loadUnit: .lb)
        XCTAssertEqual(draft.loadUnit, .kg, "keeps the unit the log was recorded in")
        XCTAssertEqual(draft.performedOn, d("2026-11-09"))
        XCTAssertEqual(draft.items[squat.id]?.map(\.load), ["100", "102.5"])
        XCTAssertEqual(draft.items[bench2k.id]?.first?.time, "7:52.5")
        XCTAssertEqual(draft.notes, "Good day")

        let resubmitted = try LogForm.submission(from: draft, workout: workout).get()
        XCTAssertEqual(resubmitted.entries.filter { $0.workoutItemId == squat.id }.map(\.load), [100, 102.5])
        XCTAssertEqual(resubmitted.entries.first { $0.workoutItemId == bench2k.id }?.timeSeconds, 472.5)
        XCTAssertEqual(resubmitted.rpe, 8)
    }

    func testDraftsSurviveBeingSavedAndRestored() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("furycore-drafts-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = FileDraftStore(directory: directory)

        var draft = LogForm.newDraft(for: workout, enrollmentId: uuid(50), performedOn: d("2026-11-10"), loadUnit: .lb, now: Date(timeIntervalSince1970: 2_000_000_000))
        draft.items[squat.id]![0].load = "22" // half-typed
        draft.items[row.id]![0].time = "9:"
        store.save(draft)

        // a new store instance stands in for the app being relaunched
        let reopened = FileDraftStore(directory: directory)
        XCTAssertEqual(reopened.load(key: LogDraft.key(workoutId: workout.id, enrollmentId: uuid(50))), draft)
        XCTAssertNil(reopened.load(key: LogDraft.key(workoutId: workout.id, enrollmentId: nil)), "gym and program logs of the same workout are separate")
        XCTAssertNil(reopened.load(key: "../../etc/passwd"))

        var older = LogForm.newDraft(for: workout, enrollmentId: nil, performedOn: d("2026-10-01"), loadUnit: .lb, now: Date(timeIntervalSince1970: 1_000_000_000))
        older.notes = "old"
        reopened.save(older)
        XCTAssertEqual(reopened.all().map(\.notes), ["", "old"], "newest first")
        XCTAssertEqual(reopened.prune(olderThan: Date(timeIntervalSince1970: 1_500_000_000)), 1)
        XCTAssertEqual(reopened.all().count, 1)

        reopened.delete(key: draft.key)
        XCTAssertNil(store.load(key: draft.key))

        let memory = MemoryDraftStore()
        memory.save(draft)
        XCTAssertEqual(memory.load(key: draft.key), draft)
        memory.delete(key: draft.key)
        XCTAssertTrue(memory.all().isEmpty)
    }
}

final class FormattingTests: XCTestCase {
    func testDurations() {
        XCTAssertEqual(Format.duration(754), "12:34")
        XCTAssertEqual(Format.duration(3723), "1:02:03")
        XCTAssertEqual(Format.duration(59.96), "1:00")
        XCTAssertEqual(Format.duration(62.5), "1:02.5")
        XCTAssertEqual(Format.duration(0), "0:00")
        XCTAssertEqual(Format.duration(-1), "—")

        XCTAssertEqual(Parse.duration("12:34"), 754)
        XCTAssertEqual(Parse.duration("1:02:03"), 3723)
        XCTAssertEqual(Parse.duration("45"), 45)
        XCTAssertEqual(Parse.duration(" 1:02.5 "), 62.5)
        XCTAssertEqual(Parse.duration("90"), 90, "a bare number is seconds")
        for bad in ["", "1:75", "1:2:3:4", "abc", "-5", "1::30", "12:", ":30"] {
            XCTAssertNil(Parse.duration(bad), bad)
        }
        for seconds in [0.0, 5, 59, 60, 61.5, 599, 3600, 3661, 86_399] {
            XCTAssertEqual(Parse.duration(Format.duration(seconds)), seconds)
        }
    }

    func testNumbersLoadsDistancesAndMoney() {
        XCTAssertEqual(Format.number(235), "235")
        XCTAssertEqual(Format.number(102.5), "102.5")
        XCTAssertEqual(Format.number(61.25), "61.25")
        XCTAssertEqual(Format.number(7.999), "8")
        XCTAssertEqual(Format.load(235, unit: "lb"), "235 lb")
        XCTAssertEqual(Format.distance(meters: 400), "400 m")
        XCTAssertEqual(Format.distance(meters: 4800), "4.8 km")
        XCTAssertEqual(Format.money(cents: 18500), "$185.00")
        XCTAssertEqual(Format.money(cents: 1_234_505), "$12,345.05")
        XCTAssertEqual(Format.money(cents: 5), "$0.05")
        XCTAssertEqual(Format.money(cents: -103), "-$1.03")
        XCTAssertEqual(Format.money(cents: 2000, currency: "cad"), "CAD 20.00")

        XCTAssertEqual(Parse.decimal("102,5"), 102.5)
        XCTAssertNil(Parse.decimal("1.2.3"))
        XCTAssertNil(Parse.decimal("-5"))
        XCTAssertNil(Parse.decimal("1e9"))
        XCTAssertEqual(Parse.integer(" 12 "), 12)
        XCTAssertNil(Parse.integer("12.0"))
        XCTAssertEqual(LoadUnit.lb.fromKilograms(100), 220.46, accuracy: 0.01)
        XCTAssertEqual(LoadUnit.kg.fromKilograms(100), 100)
    }
}

final class BookingAndAccessTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func session(startsIn minutes: Double, booked: Int = 3, capacity: Int = 12, waitlist: Int = 0, mine: BookingStatus? = nil, position: Int? = nil, status: String = "scheduled") -> ClassSession {
        ClassSession(id: UUID(), title: "Strength", startsAt: now.addingTimeInterval(minutes * 60), endsAt: now.addingTimeInterval(minutes * 60 + 3600), capacity: capacity,
                     status: status, bookedCount: booked, waitlistCount: waitlist, myBookingId: mine == nil ? nil : UUID(), myBookingStatus: mine, myWaitlistPosition: position)
    }
    func action(_ s: ClassSession) -> BookingAction {
        ClassBooking.action(for: s, now: now, cancelCutoffMinutes: 60, bookingWindowDays: 14)
    }

    func testWhatTheClassButtonOffers() {
        XCTAssertEqual(action(session(startsIn: 600)), .book)
        XCTAssertEqual(action(session(startsIn: 600, booked: 12)), .joinWaitlist)
        XCTAssertEqual(action(session(startsIn: 600, mine: .booked)), .cancel(late: false))
        XCTAssertEqual(action(session(startsIn: 61, mine: .booked)), .cancel(late: false))
        XCTAssertEqual(action(session(startsIn: 59, mine: .booked)), .cancel(late: true), "inside the cutoff the credit is not returned")
        XCTAssertEqual(action(session(startsIn: 600, booked: 12, waitlist: 2, mine: .waitlisted, position: 2)), .leaveWaitlist(position: 2))
        XCTAssertEqual(action(session(startsIn: -5)), .unavailable("Started"))
        XCTAssertEqual(action(session(startsIn: -5, mine: .booked)), .unavailable("In progress"))
        XCTAssertEqual(action(session(startsIn: -120, mine: .attended)), .unavailable("Attended"))
        XCTAssertEqual(action(session(startsIn: -120, mine: .noShow)), .unavailable("Missed"))
        XCTAssertEqual(action(session(startsIn: 600, status: "cancelled")), .unavailable("Cancelled"))
        XCTAssertEqual(action(session(startsIn: 15 * 24 * 60)), .unavailable("Not open yet"))
        XCTAssertEqual(action(session(startsIn: 600, mine: .cancelled)), .book, "a cancelled booking can be rebooked")
        XCTAssertEqual(BookingAction.cancel(late: true).title, "Cancel booking")
    }

    func testSpotsLabel() {
        XCTAssertEqual(ClassBooking.spotsLabel(for: session(startsIn: 60, booked: 3)), "9 spots left")
        XCTAssertEqual(ClassBooking.spotsLabel(for: session(startsIn: 60, booked: 11)), "1 spot left")
        XCTAssertEqual(ClassBooking.spotsLabel(for: session(startsIn: 60, booked: 12)), "Full")
        XCTAssertEqual(ClassBooking.spotsLabel(for: session(startsIn: 60, booked: 12, waitlist: 3)), "Full · 3 waiting")
    }

    func testEntitlementsSummariseMemberships() {
        let plan = Membership.PlanRef(name: "Unlimited Monthly", kind: .recurring)
        let unlimited = Membership(id: UUID(), status: .active, membershipPlans: plan)
        let pack = Membership(id: UUID(), status: .active, endsAt: now.addingTimeInterval(86_400), creditsRemaining: 3)
        let spentPack = Membership(id: UUID(), status: .active, creditsRemaining: 0)
        let expiredPack = Membership(id: UUID(), status: .active, endsAt: now.addingTimeInterval(-60), creditsRemaining: 5)

        let none = Entitlements(memberships: [], now: now)
        XCTAssertFalse(none.hasFacilityAccess)
        XCTAssertFalse(none.canBookClasses)
        XCTAssertEqual(none.headline, "No active membership")

        XCTAssertEqual(Entitlements(memberships: [unlimited], now: now).headline, "Unlimited classes")
        XCTAssertEqual(Entitlements(memberships: [pack, spentPack], now: now).headline, "3 class credits left")
        XCTAssertEqual(Entitlements(memberships: [pack, unlimited], now: now).classCredits, 3)
        XCTAssertTrue(Entitlements(memberships: [pack, unlimited], now: now).unlimited)

        let spent = Entitlements(memberships: [spentPack], now: now)
        XCTAssertTrue(spent.hasFacilityAccess)
        XCTAssertFalse(spent.canBookClasses)
        XCTAssertEqual(spent.headline, "0 class credits left")

        XCTAssertFalse(Entitlements(memberships: [expiredPack], now: now).hasFacilityAccess)
        XCTAssertFalse(Entitlements(memberships: [Membership(id: UUID(), status: .cancelled)], now: now).hasFacilityAccess)

        let pastDue = Entitlements(memberships: [Membership(id: UUID(), status: .pastDue)], now: now)
        XCTAssertTrue(pastDue.canBookClasses, "access continues while the payment is retried")
        XCTAssertEqual(pastDue.headline, "Payment problem — update your card")

        let frozen = Entitlements(memberships: [Membership(id: UUID(), status: .frozen)], now: now)
        XCTAssertFalse(frozen.hasFacilityAccess)
        XCTAssertEqual(frozen.headline, "Membership frozen")
    }

    func testServerErrorsBecomeSentences() {
        XCTAssertEqual(ServerMessage.friendly("waiver_required"), "Please sign the waiver before booking.")
        XCTAssertEqual(ServerMessage.friendly("PostgrestError: no_entitlement (P0001)"), "You need an active membership or class credit to book.")
        XCTAssertEqual(ServerMessage.friendly("connection reset"), "Something went wrong. Please try again.")
        XCTAssertEqual(ServerMessage.friendly("???", fallback: "Could not save."), "Could not save.")
        XCTAssertTrue(ServerMessage.isKnown("workout_locked"))
        XCTAssertFalse(ServerMessage.isKnown("timeout"))
    }

    func testDeepLinksAndThePurchaseLinkPolicy() {
        XCTAssertEqual(DeepLink(url: URL(string: "furyco://checkout/success")!), .checkoutSuccess)
        XCTAssertEqual(DeepLink(url: URL(string: "FURYCO://checkout/cancelled")!), .checkoutCancelled)
        XCTAssertEqual(DeepLink(url: URL(string: "furyco://auth-callback#access_token=x")!), .authCallback)
        XCTAssertNil(DeepLink(url: URL(string: "furyco://checkout/other")!))
        XCTAssertNil(DeepLink(url: URL(string: "https://checkout/success")!))

        XCTAssertTrue(PurchaseLinkPolicy.showsProgramPurchaseLink(storefrontCountryCode: "USA", gymAllows: true))
        XCTAssertTrue(PurchaseLinkPolicy.showsProgramPurchaseLink(storefrontCountryCode: "usa", gymAllows: true))
        XCTAssertFalse(PurchaseLinkPolicy.showsProgramPurchaseLink(storefrontCountryCode: "GBR", gymAllows: true))
        XCTAssertFalse(PurchaseLinkPolicy.showsProgramPurchaseLink(storefrontCountryCode: "USA", gymAllows: false))
        XCTAssertFalse(PurchaseLinkPolicy.showsProgramPurchaseLink(storefrontCountryCode: nil, gymAllows: true), "unknown storefront: do not show")
    }
}
