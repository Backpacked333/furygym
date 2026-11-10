import Charts
import FuryCore
import SwiftUI

/// Personal records, benchmark history, adherence and the training log.
struct ProgressScreen: View {
    private struct Snapshot {
        var records: [PersonalRecord]
        var benchmarks: [BenchmarkResult]
        var logs: [WorkoutLog]
        var month: [CalendarEntry]
    }

    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            AsyncContent(reloadKey: model.revision, load: load) { snapshot in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        summary(snapshot)
                        recordsSection(snapshot.records)
                        benchmarksSection(snapshot.benchmarks)
                        historySection(snapshot.logs)
                    }
                    .padding(16)
                }
                .screenBackground()
            }
            .navigationTitle("Progress")
            .navigationDestination(for: PersonalRecord.self) { ExerciseProgressView(record: $0) }
            .navigationDestination(for: WorkoutLog.self) { LogDetailView(log: $0) }
        }
    }

    private func load() async throws -> Snapshot {
        let today = model.today
        async let records = model.backend.personalRecords()
        async let benchmarks = model.backend.benchmarkResults()
        async let logs = model.backend.recentLogs(limit: 40)
        async let month = model.backend.calendar(from: today.adding(days: -27), to: today)
        return Snapshot(records: try await records, benchmarks: try await benchmarks, logs: try await logs, month: try await month)
    }

    private func summary(_ snapshot: Snapshot) -> some View {
        let adherence = Adherence.through(model.today, entries: snapshot.month.filter { !$0.locked })
        let streak = Streak.current(loggedDays: Set(snapshot.logs.map(\.performedOn)), today: model.today)
        return HStack(spacing: 12) {
            stat("\(adherence.percent)%", "Last 4 weeks", detail: "\(adherence.completed)/\(adherence.scheduled) sessions")
            stat("\(streak)", "Day streak", detail: streak == 1 ? "day in a row" : "days in a row")
            stat("\(snapshot.records.count)", "Records", detail: "lifts tracked")
        }
    }

    private func stat(_ value: String, _ label: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title2.bold().monospacedDigit())
            Text(label).font(.caption.weight(.semibold))
            Text(detail).font(.caption2).foregroundStyle(Theme.muted)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func recordsSection(_ records: [PersonalRecord]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Personal records")
            if records.isEmpty {
                Card { Text("Log a lift with a load to start tracking records.").font(.subheadline).foregroundStyle(Theme.muted) }
            } else {
                ForEach(records) { record in
                    NavigationLink(value: record) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(record.exerciseName).font(.headline)
                                Text(DateText.day(record.performedOn, in: model.timeZone)).font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Text("\(Format.load(record.load, unit: record.loadUnit))\(record.reps.map { " × \($0)" } ?? "")")
                                .font(.headline.monospacedDigit())
                            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.muted)
                        }
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private func benchmarksSection(_ results: [BenchmarkResult]) -> some View {
        let names = Array(Set(results.map(\.benchmarkName))).sorted()
        if !names.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: "Benchmarks")
                ForEach(names, id: \.self) { name in
                    BenchmarkCard(name: name, results: results.filter { $0.benchmarkName == name })
                }
            }
        }
    }

    @ViewBuilder private func historySection(_ logs: [WorkoutLog]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Training log")
            if logs.isEmpty {
                Card { Text("Workouts you log will appear here.").font(.subheadline).foregroundStyle(Theme.muted) }
            } else {
                ForEach(logs) { log in
                    NavigationLink(value: log) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(log.title).font(.subheadline.weight(.semibold))
                                Text(DateText.day(log.performedOn, in: model.timeZone)).font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            if !log.coachFeedback.isEmpty { Image(systemName: "bubble.left.fill").font(.caption).foregroundStyle(Theme.accent).accessibilityLabel("Coach feedback") }
                            if log.prCount > 0 { Pill(text: "PR", color: Theme.accent) }
                            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.muted)
                        }
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct BenchmarkCard: View {
    @Environment(AppModel.self) private var model
    let name: String
    let results: [BenchmarkResult]

    var body: some View {
        let timed = results.filter { $0.timeSeconds != nil }
        Card {
            HStack {
                Text(name).font(.headline)
                Spacer()
                if let best = timed.map({ $0.timeSeconds! }).min() {
                    Text(Format.duration(best)).font(.headline.monospacedDigit())
                } else if let best = results.compactMap(\.reps).max() {
                    Text("\(best) reps").font(.headline.monospacedDigit())
                }
            }
            if timed.count > 1 {
                Chart(timed) { result in
                    LineMark(x: .value("Date", result.performedOn.noon(in: model.timeZone)), y: .value("Seconds", result.timeSeconds ?? 0))
                    PointMark(x: .value("Date", result.performedOn.noon(in: model.timeZone)), y: .value("Seconds", result.timeSeconds ?? 0))
                }
                .foregroundStyle(Theme.accent)
                .chartYAxis {
                    AxisMarks { value in
                        AxisGridLine()
                        AxisValueLabel { if let seconds = value.as(Double.self) { Text(Format.duration(seconds)) } }
                    }
                }
                .frame(height: 120)
                .accessibilityLabel("\(name) times over \(timed.count) attempts")
            }
            Text(results.count == 1 ? "1 attempt" : "\(results.count) attempts").font(.caption).foregroundStyle(Theme.muted)
        }
    }
}

/// Load over time for one exercise.
struct ExerciseProgressView: View {
    @Environment(AppModel.self) private var model
    let record: PersonalRecord

    var body: some View {
        AsyncContent(reloadKey: 0, load: { try await model.backend.liftSamples(exerciseID: record.exerciseId) }) { samples in
            let series = ProgressSeries.bestLoadPerDay(samples, unit: model.loadUnit)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Card {
                        SectionLabel(text: "Best load each session (\(model.loadUnit.rawValue))")
                        if series.count > 1 {
                            Chart(series, id: \.date) { point in
                                LineMark(x: .value("Date", point.date.noon(in: model.timeZone)), y: .value("Load", point.load))
                                PointMark(x: .value("Date", point.date.noon(in: model.timeZone)), y: .value("Load", point.load))
                            }
                            .foregroundStyle(Theme.accent)
                            .chartYScale(domain: .automatic(includesZero: false))
                            .frame(height: 220)
                            .accessibilityLabel("\(record.exerciseName) load over \(series.count) sessions")
                        } else {
                            Text("Log this lift again to see a trend.").font(.subheadline).foregroundStyle(Theme.muted)
                        }
                    }
                    Card {
                        SectionLabel(text: "Sessions")
                        ForEach(series.reversed(), id: \.date) { point in
                            HStack {
                                Text(DateText.day(point.date, in: model.timeZone)).font(.subheadline)
                                Spacer()
                                Text(Format.load(point.load, unit: model.loadUnit.rawValue)).font(.subheadline.monospacedDigit())
                            }
                        }
                    }
                }
                .padding(16)
            }
            .screenBackground()
        }
        .navigationTitle(record.exerciseName)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One logged session, read-only, with coach feedback.
struct LogDetailView: View {
    @Environment(AppModel.self) private var model
    let log: WorkoutLog

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(DateText.longDay(log.performedOn, in: model.timeZone)).font(.caption).foregroundStyle(Theme.muted)
                    Text(log.title).font(.title2.bold())
                    if let rpe = log.rpe { Text("Session RPE \(Format.number(rpe))").font(.subheadline).foregroundStyle(Theme.muted) }
                }
                if !log.entries.isEmpty {
                    Card {
                        ForEach(log.entries) { entry in
                            HStack {
                                Text(entry.benchmarkName ?? "Set \(entry.setIndex)").font(.caption).foregroundStyle(Theme.muted).frame(width: 64, alignment: .leading)
                                Text(Format.summary(of: entry)).font(.subheadline.monospacedDigit())
                                Spacer()
                                if entry.isPr { Pill(text: "PR", color: Theme.accent) }
                            }
                        }
                    }
                }
                if let notes = log.notes, !notes.isEmpty {
                    Card {
                        SectionLabel(text: "Your notes")
                        Text(notes).font(.subheadline)
                    }
                }
                ForEach(log.coachFeedback) { feedback in
                    Card {
                        SectionLabel(text: "Coach feedback")
                        Text(feedback.body).font(.subheadline)
                        Text(DateText.date(feedback.createdAt, in: model.timeZone)).font(.caption).foregroundStyle(Theme.muted)
                    }
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }
}
