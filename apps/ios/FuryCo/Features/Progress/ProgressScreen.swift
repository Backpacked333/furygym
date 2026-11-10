import Charts
import FuryCore
import SwiftUI

/// Adherence, personal records with their trend, benchmarks and the training log.
struct ProgressScreen: View {
    private struct Snapshot {
        var trends: [LiftTrend]
        var benchmarks: [BenchmarkResult]
        var logs: [WorkoutLog]
        var calendar: [CalendarEntry]
    }

    @Environment(AppModel.self) private var model
    @State private var segment = 0

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: load) { snapshot in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Last 12 weeks", title: "Progress").padding(.top, 8)
                    PillSegmented(options: ["PRs", "Benchmarks", "History"], selection: $segment)
                    adherenceCard(snapshot)
                    switch segment {
                    case 1: benchmarks(snapshot.benchmarks)
                    case 2: history(snapshot.logs)
                    default: records(snapshot.trends)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .screenBackground()
            .withTabBar()
        }
        .navigationDestination(for: LiftRoute.self) { LiftHistoryView(route: $0) }
        .navigationDestination(for: WorkoutLog.self) { LogDetailView(log: $0) }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func load() async throws -> Snapshot {
        let today = model.today
        async let records = model.backend.personalRecords()
        async let samples = model.backend.allLiftSamples()
        async let benchmarks = model.backend.benchmarkResults()
        async let logs = model.backend.recentLogs(limit: 120)
        async let calendar = model.backend.calendar(from: today.adding(days: -83), to: today)
        return Snapshot(
            trends: LiftTrend.build(records: try await records, samples: try await samples),
            benchmarks: try await benchmarks, logs: try await logs, calendar: try await calendar
        )
    }

    private func adherenceCard(_ snapshot: Snapshot) -> some View {
        let adherence = Adherence.through(model.today, entries: snapshot.calendar.filter { !$0.locked })
        let weeks = WeeklyActivity.counts(loggedDays: snapshot.logs.map(\.performedOn), weeks: 12, today: model.today)
        return FCard(spacing: 16) {
            HStack(spacing: 16) {
                Ring(progress: adherence.rate, size: 76, lineWidth: 8) {
                    Text("\(adherence.percent)%").font(.headline.monospacedDigit())
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Adherence").font(.headline)
                    Text(adherence.scheduled == 0 ? "Nothing scheduled yet" : "\(adherence.completed) of \(adherence.scheduled) sessions logged")
                        .font(.footnote).foregroundStyle(FC.label2)
                }
            }
            MiniBars(values: weeks)
            Text("Sessions logged per week").font(.caption2.weight(.semibold)).foregroundStyle(FC.label2)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func records(_ trends: [LiftTrend]) -> some View {
        if trends.isEmpty {
            FCard { Text("Log a lift with a load to start tracking records.").foregroundStyle(FC.label2) }
        } else {
            ListGroup {
                ForEach(Array(trends.enumerated()), id: \.element.id) { index, trend in
                    NavigationLink(value: LiftRoute(exerciseID: trend.exerciseId, name: trend.name)) {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(trend.title).font(.body)
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text(Format.number(TrainingMath.displayLoad(kilograms: trend.bestKg, unit: model.loadUnit))).font(FC.metric(22))
                                    Text(model.loadUnit.rawValue).font(.footnote).foregroundStyle(FC.label2)
                                    if let delta = trend.deltaKg, delta > 0 {
                                        Text("+\(Format.number(TrainingMath.displayLoad(kilograms: delta, unit: model.loadUnit)))").font(.footnote.weight(.semibold)).foregroundStyle(FC.green)
                                    }
                                }
                            }
                            Spacer(minLength: 8)
                            Sparkline(values: trend.series.map(\.estimatedMaxKg)).frame(width: 84, height: 36)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(FC.label3)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .overlay(alignment: .bottom) { if index < trends.count - 1 { FC.separator.frame(height: 0.5).padding(.leading, 16) } }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private func benchmarks(_ results: [BenchmarkResult]) -> some View {
        let names = Array(Set(results.map(\.benchmarkName))).sorted()
        if names.isEmpty {
            FCard { Text("Benchmark workouts you complete will be tracked here.").foregroundStyle(FC.label2) }
        } else {
            ListGroup {
                ForEach(Array(names.enumerated()), id: \.element) { index, name in
                    let attempts = results.filter { $0.benchmarkName == name }.sorted { $0.performedOn < $1.performedOn }
                    let times = attempts.compactMap(\.timeSeconds)
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name).font(.body)
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(times.min().map(Format.duration) ?? attempts.compactMap(\.reps).max().map { "\($0) reps" } ?? "—").font(FC.metric(22))
                                if times.count > 1, let first = times.first, let best = times.min(), best < first {
                                    Text("−\(Format.duration(first - best))").font(.footnote.weight(.semibold)).foregroundStyle(FC.green)
                                }
                            }
                            Text(attempts.count == 1 ? "1 attempt" : "\(attempts.count) attempts").font(.caption).foregroundStyle(FC.label2)
                        }
                        Spacer(minLength: 8)
                        // A faster time is better, so the line is drawn inverted: up means improvement.
                        Sparkline(values: times.map { -$0 }).frame(width: 84, height: 36)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .overlay(alignment: .bottom) { if index < names.count - 1 { FC.separator.frame(height: 0.5).padding(.leading, 16) } }
                }
            }
        }
    }

    @ViewBuilder private func history(_ logs: [WorkoutLog]) -> some View {
        if logs.isEmpty {
            FCard { Text("Workouts you log will appear here.").foregroundStyle(FC.label2) }
        } else {
            ListGroup {
                ForEach(Array(logs.prefix(40).enumerated()), id: \.element.id) { index, log in
                    NavigationLink(value: log) {
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(log.title).font(.body)
                                Text(DateText.day(log.performedOn, in: model.timeZone) + (log.rpe.map { " · RPE \(Format.number($0))" } ?? "")).font(.footnote).foregroundStyle(FC.label2)
                            }
                            Spacer(minLength: 8)
                            if !log.coachFeedback.isEmpty { Image(systemName: "bubble.left.fill").font(.caption).foregroundStyle(FC.red).accessibilityLabel("Coach feedback") }
                            if log.prCount > 0 { Chip(text: "PR", color: FC.yellow, systemImage: "medal.fill") }
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(FC.label3)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 60)
                        .overlay(alignment: .bottom) { if index < min(logs.count, 40) - 1 { FC.separator.frame(height: 0.5).padding(.leading, 16) } }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

struct LiftRoute: Hashable {
    let exerciseID: UUID
    let name: String
}

/// One lift over time: estimated 1RM chart, coach feedback, and every session.
struct LiftHistoryView: View {
    private struct Snapshot {
        var samples: [LiftSample]
        var logs: [WorkoutLog]
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let route: LiftRoute
    @State private var rangeIndex = 1

    var body: some View {
        AsyncContent(reloadKey: 0, load: load) { snapshot in
            let months = [3, 6, 12][rangeIndex]
            let cutoff = model.today.adding(days: -months * 30)
            let series = LiftTrend.series(for: snapshot.samples).filter { $0.date >= cutoff }
            let unit = model.loadUnit
            let display = { (kg: Double) in TrainingMath.displayLoad(kilograms: kg, unit: unit) }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    FCard(spacing: 14) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Estimated 1RM").font(.footnote).foregroundStyle(FC.label2)
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text(series.last.map { Format.number(display($0.estimatedMaxKg)) } ?? "—").font(FC.metric(34))
                                    Text(unit.rawValue).foregroundStyle(FC.label2)
                                }
                                if let first = series.first, let last = series.last, series.count > 1 {
                                    let change = display(last.estimatedMaxKg) - display(first.estimatedMaxKg)
                                    Text("\(change >= 0 ? "+" : "−")\(Format.number(abs(change))) \(unit.rawValue) in \(months) months")
                                        .font(.footnote.weight(.semibold)).foregroundStyle(change >= 0 ? FC.green : FC.orange)
                                }
                            }
                            Spacer()
                            PillSegmented(options: ["3M", "6M", "1Y"], selection: $rangeIndex).frame(width: 150)
                        }
                        if series.count > 1 {
                            Chart(series, id: \.date) { point in
                                AreaMark(x: .value("Date", point.date.noon(in: model.timeZone)), y: .value("Estimated 1RM", display(point.estimatedMaxKg)))
                                    .foregroundStyle(FC.red.opacity(0.14))
                                LineMark(x: .value("Date", point.date.noon(in: model.timeZone)), y: .value("Estimated 1RM", display(point.estimatedMaxKg)))
                                    .foregroundStyle(FC.red)
                                PointMark(x: .value("Date", point.date.noon(in: model.timeZone)), y: .value("Estimated 1RM", display(point.estimatedMaxKg)))
                                    .foregroundStyle(FC.red)
                            }
                            .chartYScale(domain: .automatic(includesZero: false))
                            .frame(height: 180)
                            .accessibilityLabel("\(route.name) estimated one-rep max over \(series.count) sessions")
                        } else {
                            Text("Log this lift again to see a trend.").font(.subheadline).foregroundStyle(FC.label2)
                        }
                    }

                    ForEach(feedback(in: snapshot.logs).prefix(2), id: \.1.id) { log, note in
                        FCard {
                            HStack {
                                Text("Coach").font(.headline)
                                Text(DateText.date(note.createdAt, in: model.timeZone)).font(.footnote).foregroundStyle(FC.label2)
                                Spacer()
                                Chip(text: "Feedback", color: FC.red)
                            }
                            Text(note.body).font(.body)
                            Text(log.title).font(.caption).foregroundStyle(FC.label2)
                        }
                    }

                    let sessions = sessionRows(snapshot.samples)
                    let bestLoad = sessions.map(\.loadKg).max()
                    if !sessions.isEmpty {
                        ListGroup {
                            ForEach(Array(sessions.enumerated()), id: \.element.date) { index, session in
                                ListRow(
                                    title: "\(DateText.shortDay(session.date, in: model.timeZone)) · \(Format.number(display(session.loadKg)))\(session.reps.map { " × \($0)" } ?? "")",
                                    value: session.loadKg == bestLoad ? "Best" : nil,
                                    showChevron: false, isLast: index == sessions.count - 1
                                )
                            }
                        }
                    }
                }
                .padding(16)
            }
            .screenBackground()
        }
        .navigationTitle(route.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { GlassIconButton(systemName: "chevron.left", label: "Back") { dismiss() } }
        }
    }

    private func load() async throws -> Snapshot {
        async let samples = model.backend.liftSamples(exerciseID: route.exerciseID)
        async let logs = model.backend.recentLogs(limit: 60)
        return Snapshot(samples: try await samples, logs: (try? await logs) ?? [])
    }

    /// Coach notes on sessions that included this lift, newest first.
    private func feedback(in logs: [WorkoutLog]) -> [(WorkoutLog, CoachFeedback)] {
        logs.filter { log in log.workoutLogEntries.contains { $0.exerciseId == route.exerciseID } }
            .flatMap { log in log.coachFeedback.map { (log, $0) } }
            .sorted { $0.1.createdAt > $1.1.createdAt }
    }

    private struct SessionRow {
        let date: DayDate
        let loadKg: Double
        let reps: Int?
    }

    /// The heaviest set of each day, newest first.
    private func sessionRows(_ samples: [LiftSample]) -> [SessionRow] {
        var best: [DayDate: LiftSample] = [:]
        for sample in samples where sample.loadKg > (best[sample.performedOn]?.loadKg ?? 0) { best[sample.performedOn] = sample }
        return best.values.sorted { $0.performedOn > $1.performedOn }.prefix(20).map { SessionRow(date: $0.performedOn, loadKg: $0.loadKg, reps: $0.reps) }
    }
}

/// One logged session, read-only, with coach feedback.
struct LogDetailView: View {
    @Environment(AppModel.self) private var model
    let log: WorkoutLog

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: DateText.longDay(log.performedOn, in: model.timeZone), title: log.title)
                if let rpe = log.rpe { Chip(text: "Session RPE \(Format.number(rpe))", color: FC.red) }
                if !log.entries.isEmpty {
                    ListGroup {
                        ForEach(Array(log.entries.enumerated()), id: \.element.id) { index, entry in
                            ListRow(
                                title: Format.summary(of: entry).isEmpty ? "Completed" : Format.summary(of: entry),
                                subtitle: entry.benchmarkName ?? "Set \(entry.setIndex)",
                                value: entry.isPr ? "PR" : nil, showChevron: false, isLast: index == log.entries.count - 1
                            )
                        }
                    }
                }
                if let notes = log.notes, !notes.isEmpty {
                    FCard {
                        Eyebrow(text: "Your notes")
                        Text(notes)
                    }
                }
                ForEach(log.coachFeedback) { feedback in
                    FCard {
                        HStack {
                            Eyebrow(text: "Coach feedback", color: FC.red)
                            Spacer()
                            Text(DateText.date(feedback.createdAt, in: model.timeZone)).font(.caption).foregroundStyle(FC.label2)
                        }
                        Text(feedback.body)
                    }
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }
}
