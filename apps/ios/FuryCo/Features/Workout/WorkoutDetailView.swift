import FuryCore
import SwiftUI

/// A workout as the coach wrote it, plus the athlete's own log and any coach feedback.
struct WorkoutDetailView: View {
    private struct Detail {
        var workout: Workout
        var log: WorkoutLog?
    }

    @Environment(AppModel.self) private var model
    let route: WorkoutRoute
    @State private var logging: Detail?
    @State private var reload = 0

    var body: some View {
        AsyncContent(reloadKey: reload, load: load) { detail in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(DateText.longDay(route.date, in: model.timeZone)).font(.caption).foregroundStyle(Theme.muted)
                        Text(detail.workout.title).font(.title.bold())
                        if let description = detail.workout.description { Text(description).foregroundStyle(Theme.muted) }
                    }

                    if let notes = detail.workout.coachNotes, !notes.isEmpty {
                        Card {
                            SectionLabel(text: "Coach notes")
                            Text(notes).font(.subheadline)
                        }
                    }

                    ForEach(detail.workout.items) { item in
                        ItemCard(item: item, entries: detail.log?.entries.filter { $0.workoutItemId == item.id } ?? [])
                    }

                    if let log = detail.log { logSummary(log) }

                    Button(detail.log == nil ? "Log this workout" : "Edit your log") { logging = detail }
                        .buttonStyle(PrimaryButtonStyle())
                }
                .padding(16)
            }
            .screenBackground()
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: Binding(get: { logging != nil }, set: { if !$0 { logging = nil } })) {
            if let detail = logging {
                LogWorkoutView(workout: detail.workout, existing: detail.log, route: route) {
                    reload += 1
                    model.didChange()
                }
            }
        }
    }

    private func load() async throws -> Detail {
        guard let workout = try await model.backend.workout(id: route.workoutID) else {
            throw Backend.WebError(message: ServerMessage.friendly("workout_locked"))
        }
        let logs = try await model.backend.recentLogs(limit: 60)
        return Detail(workout: workout, log: logs.first { $0.workoutId == route.workoutID && $0.enrollmentId == route.enrollmentID })
    }

    private func logSummary(_ log: WorkoutLog) -> some View {
        Card {
            HStack {
                SectionLabel(text: "Your log")
                Spacer()
                if log.prCount > 0 { Pill(text: log.prCount == 1 ? "1 PR" : "\(log.prCount) PRs", color: Theme.accent) }
            }
            Text("Logged for \(DateText.day(log.performedOn, in: model.timeZone))\(log.rpe.map { " · RPE \(Format.number($0))" } ?? "")")
                .font(.subheadline)
            if let notes = log.notes, !notes.isEmpty {
                Text("“\(notes)”").font(.footnote).italic().foregroundStyle(Theme.muted)
            }
            ForEach(log.coachFeedback) { feedback in
                VStack(alignment: .leading, spacing: 2) {
                    Text("COACH").font(.caption2.weight(.bold)).foregroundStyle(Theme.accent)
                    Text(feedback.body).font(.footnote)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

private struct ItemCard: View {
    let item: WorkoutItem
    let entries: [LogEntry]

    var body: some View {
        Card {
            if let section = item.section, !section.isEmpty { SectionLabel(text: section) }
            Text(item.title).font(.headline)
            if let prescription = item.prescription { Text(prescription).font(.body) }
            if let scaling = item.scaling, !scaling.isEmpty {
                Text("Scale: \(scaling)").font(.footnote).foregroundStyle(Theme.muted)
            }
            if let notes = item.notes, !notes.isEmpty {
                Text(notes).font(.footnote).foregroundStyle(Theme.muted)
            }
            if let video = item.videoUrl.flatMap(URL.init(string:)), video.scheme?.hasPrefix("http") == true {
                Link(destination: video) { Label("Watch instruction video", systemImage: "play.rectangle.fill").font(.footnote.weight(.semibold)) }
            }
            if !entries.isEmpty {
                Divider().overlay(Theme.line)
                ForEach(entries) { entry in
                    HStack {
                        Text(Format.summary(of: entry)).font(.footnote.monospacedDigit())
                        if entry.isPr { Pill(text: "PR", color: Theme.accent) }
                    }
                    if let comments = entry.comments { Text(comments).font(.caption).foregroundStyle(Theme.muted) }
                }
            } else if !item.recordedMetrics.isEmpty {
                Text("Record: \(item.recordedMetrics.map(\.label).joined(separator: ", "))")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
        }
    }
}
