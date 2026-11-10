import Foundation

/// What the athlete typed for one set of one workout item. Everything is text until submit, so a
/// half-typed value ("12:") survives being saved as a draft and restored.
public struct SetDraft: Codable, Equatable, Sendable {
    public var load = ""
    public var sets = ""
    public var reps = ""
    public var time = ""
    public var distance = ""
    public var distanceUnit: DistanceUnit = .m
    public var pace = ""
    public var paceUnit = "km"
    public var splits: [String] = []
    public var rpe = ""
    public var comments = ""

    public init() {}

    public var isEmpty: Bool {
        [load, sets, reps, time, distance, pace, rpe, comments].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
            && splits.allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
    }
}

/// An in-progress workout log. Saved on device as the athlete types so nothing is lost if the
/// signal drops on the gym floor.
public struct LogDraft: Codable, Equatable, Sendable {
    public var workoutId: UUID
    public var enrollmentId: UUID?
    public var performedOn: DayDate
    public var loadUnit: LoadUnit
    public var notes = ""
    public var rpe = ""
    /// Sets per workout item, keyed by the item's id.
    public var items: [UUID: [SetDraft]]
    public var updatedAt: Date

    public var key: String { LogDraft.key(workoutId: workoutId, enrollmentId: enrollmentId) }

    public static func key(workoutId: UUID, enrollmentId: UUID?) -> String {
        "\(workoutId.uuidString.lowercased())_\(enrollmentId?.uuidString.lowercased() ?? "gym")"
    }

    public var hasContent: Bool {
        !notes.trimmingCharacters(in: .whitespaces).isEmpty || !rpe.isEmpty || items.values.contains { $0.contains { !$0.isEmpty } }
    }
}

/// One entry of the `p_entries` array sent to `submit_workout_log`.
public struct LogEntryPayload: Encodable, Equatable, Sendable {
    public var workoutItemId: UUID
    public var setIndex: Int
    public var load: Double?
    public var loadUnit: String?
    public var sets: Int?
    public var reps: Int?
    public var timeSeconds: Double?
    public var distanceM: Double?
    public var paceSeconds: Double?
    public var paceUnit: String?
    public var splits: [Double]?
    public var rpe: Double?
    public var comments: String?

    enum CodingKeys: String, CodingKey {
        case workoutItemId = "workout_item_id", setIndex = "set_index", load, loadUnit = "load_unit", sets, reps
        case timeSeconds = "time_seconds", distanceM = "distance_m", paceSeconds = "pace_seconds", paceUnit = "pace_unit"
        case splits, rpe, comments
    }
}

public struct LogSubmission: Equatable, Sendable {
    public var entries: [LogEntryPayload]
    public var notes: String?
    public var rpe: Double?
}

public struct LogValidationError: Error, Equatable, Sendable, CustomStringConvertible {
    public let itemTitle: String?
    public let message: String

    public init(itemTitle: String?, message: String) {
        self.itemTitle = itemTitle
        self.message = message
    }

    public var description: String { itemTitle.map { "\($0): \(message)" } ?? message }
}

public enum LogForm {
    /// Strength-style items (load and/or reps, not a benchmark) are logged set by set.
    public static func allowsMultipleSets(_ item: WorkoutItem) -> Bool {
        !item.isBenchmark && (item.metrics.contains(.load) || item.metrics.contains(.reps)) && !item.metrics.contains(.sets)
    }

    /// A fresh draft: one empty set per item that has something to record.
    public static func newDraft(for workout: Workout, enrollmentId: UUID?, performedOn: DayDate, loadUnit: LoadUnit, now: Date = Date()) -> LogDraft {
        var items: [UUID: [SetDraft]] = [:]
        for item in workout.items where !item.recordedMetrics.isEmpty {
            items[item.id] = [SetDraft()]
        }
        return LogDraft(workoutId: workout.id, enrollmentId: enrollmentId, performedOn: performedOn, loadUnit: loadUnit, items: items, updatedAt: now)
    }

    /// A draft pre-filled from a log the athlete already submitted, for editing.
    public static func draft(from log: WorkoutLog, workout: Workout, loadUnit: LoadUnit, now: Date = Date()) -> LogDraft {
        var draft = newDraft(for: workout, enrollmentId: log.enrollmentId, performedOn: log.performedOn, loadUnit: loadUnit, now: now)
        draft.notes = log.notes ?? ""
        draft.rpe = log.rpe.map(Format.number) ?? ""
        let byItem = Dictionary(grouping: log.entries.filter { $0.workoutItemId != nil }, by: { $0.workoutItemId! })
        for (itemId, entries) in byItem where draft.items[itemId] != nil {
            draft.items[itemId] = entries.sorted { $0.setIndex < $1.setIndex }.map { entry in
                var set = SetDraft()
                set.load = entry.load.map(Format.number) ?? ""
                set.sets = entry.sets.map(String.init) ?? ""
                set.reps = entry.reps.map(String.init) ?? ""
                set.time = entry.timeSeconds.map(Format.duration) ?? ""
                set.distance = entry.distanceM.map(Format.number) ?? ""
                set.pace = entry.paceSeconds.map(Format.duration) ?? ""
                set.paceUnit = entry.paceUnit ?? "km"
                set.splits = (entry.splits ?? []).map(Format.duration)
                set.rpe = entry.rpe.map(Format.number) ?? ""
                set.comments = entry.comments ?? ""
                return set
            }
        }
        // Keep the unit the log was recorded in. Entries without a load carry only the column default.
        if let unit = log.entries.first(where: { $0.load != nil })?.loadUnit, let parsed = LoadUnit(rawValue: unit) {
            draft.loadUnit = parsed
        }
        return draft
    }

    /// Checks what was typed and turns it into the payload for the server. Only fields the coach
    /// asked for are sent; empty sets are dropped.
    public static func submission(from draft: LogDraft, workout: Workout) -> Result<LogSubmission, LogValidationError> {
        var entries: [LogEntryPayload] = []

        for item in workout.items {
            let metrics = Set(item.recordedMetrics)
            guard !metrics.isEmpty, let sets = draft.items[item.id] else { continue }
            var index = 0
            for set in sets where !set.isEmpty {
                index += 1
                var payload = LogEntryPayload(workoutItemId: item.id, setIndex: index)
                func fail(_ message: String) -> Result<LogSubmission, LogValidationError> {
                    .failure(LogValidationError(itemTitle: item.title, message: message))
                }

                if metrics.contains(.load), !set.load.isBlank {
                    guard let value = Parse.decimal(set.load), value <= 2000 else { return fail("Load must be a number.") }
                    payload.load = value
                    payload.loadUnit = draft.loadUnit.rawValue
                }
                if metrics.contains(.sets), !set.sets.isBlank {
                    guard let value = Parse.integer(set.sets), value <= 100 else { return fail("Sets must be a whole number.") }
                    payload.sets = value
                }
                if metrics.contains(.reps), !set.reps.isBlank {
                    guard let value = Parse.integer(set.reps), value <= 10_000 else { return fail("Reps must be a whole number.") }
                    payload.reps = value
                }
                if metrics.contains(.time), !set.time.isBlank {
                    guard let value = Parse.duration(set.time) else { return fail("Enter time as mm:ss.") }
                    payload.timeSeconds = value
                }
                if metrics.contains(.distance), !set.distance.isBlank {
                    guard let value = Parse.decimal(set.distance) else { return fail("Distance must be a number.") }
                    payload.distanceM = (value * set.distanceUnit.meters * 100).rounded() / 100
                }
                if metrics.contains(.pace), !set.pace.isBlank {
                    guard let value = Parse.duration(set.pace) else { return fail("Enter pace as mm:ss.") }
                    payload.paceSeconds = value
                    payload.paceUnit = set.paceUnit
                }
                if metrics.contains(.splits) {
                    let typed = set.splits.filter { !$0.isBlank }
                    if !typed.isEmpty {
                        let parsed = typed.compactMap(Parse.duration)
                        guard parsed.count == typed.count else { return fail("Enter each split as mm:ss.") }
                        payload.splits = parsed
                    }
                }
                if metrics.contains(.rpe), !set.rpe.isBlank {
                    guard let value = Parse.decimal(set.rpe), value <= 10 else { return fail("RPE is a number from 0 to 10.") }
                    payload.rpe = value
                }
                if metrics.contains(.comments), !set.comments.isBlank {
                    payload.comments = set.comments.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                entries.append(payload)
            }
        }

        var overallRPE: Double?
        if !draft.rpe.isBlank {
            guard let value = Parse.decimal(draft.rpe), value <= 10 else {
                return .failure(LogValidationError(itemTitle: nil, message: "Session RPE is a number from 0 to 10."))
            }
            overallRPE = value
        }
        let notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)

        // A workout with nothing to record (or one the athlete just wants to tick off) can still
        // be marked done, but an entirely empty form with recordable fields is probably a mistake.
        let hasRecordable = workout.items.contains { !$0.recordedMetrics.isEmpty }
        if hasRecordable && entries.isEmpty && notes.isEmpty && overallRPE == nil {
            return .failure(LogValidationError(itemTitle: nil, message: "Enter at least one result, or add a note."))
        }
        return .success(LogSubmission(entries: entries, notes: notes.isEmpty ? nil : notes, rpe: overallRPE))
    }
}

private extension String {
    var isBlank: Bool { trimmingCharacters(in: .whitespaces).isEmpty }
}
