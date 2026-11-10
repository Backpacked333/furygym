import FuryCore
import SwiftUI

/// A workout as the coach wrote it: lettered blocks, scaling, movement notes and video, with the
/// athlete's own log and coach feedback once it is done.
struct WorkoutDetailView: View {
    struct Detail {
        var workout: Workout
        var log: WorkoutLog?
        var last: [UUID: LastPerformance]
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let route: WorkoutRoute

    @State private var logging: Detail?
    @State private var reload = 0
    @State private var tier = 0

    var body: some View {
        AsyncContent(reloadKey: reload, load: load) { detail in
            let hasScaling = detail.workout.items.contains { !($0.scaling ?? "").isEmpty }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ZStack(alignment: .bottomLeading) {
                        HeroBackdrop().frame(height: 230)
                        VStack(alignment: .leading, spacing: 8) {
                            Text(detail.workout.title).font(.title.bold())
                            Text(DateText.longDay(route.date, in: model.timeZone)).font(.subheadline).foregroundStyle(FC.label2)
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                    }
                    .padding(.horizontal, -16)

                    if let description = detail.workout.description, !description.isEmpty {
                        Text(description).font(.subheadline).foregroundStyle(FC.label2).padding(.horizontal, 4)
                    }
                    if hasScaling { PillSegmented(options: ["Rx", "Scaled"], selection: $tier) }

                    ForEach(Array(detail.workout.items.enumerated()), id: \.element.id) { index, item in
                        BlockCard(index: index, item: item, scaled: tier == 1, entries: detail.log?.entries.filter { $0.workoutItemId == item.id } ?? []) { url in openURL(url) }
                    }

                    if let notes = detail.workout.coachNotes, !notes.isEmpty {
                        FCard {
                            Eyebrow(text: "Coach notes", color: FC.red)
                            Text(notes).font(.subheadline)
                        }
                    }
                    if let log = detail.log { logSummary(log) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .ignoresSafeArea(edges: .top)
            .screenBackground()
            .bottomBar {
                Button { logging = detail } label: {
                    Label(detail.log == nil ? "Start workout" : "Edit your log", systemImage: detail.log == nil ? "play.fill" : "pencil")
                }
                .buttonStyle(.fcFilled)
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { GlassIconButton(systemName: "chevron.left", label: "Back") { dismiss() } }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .fullScreenCover(isPresented: Binding(get: { logging != nil }, set: { if !$0 { logging = nil } })) {
            if let detail = logging {
                LogWorkoutView(workout: detail.workout, existing: detail.log, last: detail.last, route: route) {
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
        async let logs = model.backend.recentLogs(limit: 60)
        async let samples = model.backend.allLiftSamples()
        let log = try await logs.first { $0.workoutId == route.workoutID && $0.enrollmentId == route.enrollmentID }
        return Detail(workout: workout, log: log, last: LastPerformance.byExercise((try? await samples) ?? []))
    }

    private func logSummary(_ log: WorkoutLog) -> some View {
        FCard {
            HStack {
                Eyebrow(text: "Your log", color: FC.green)
                Spacer()
                if log.prCount > 0 { Chip(text: log.prCount == 1 ? "PR" : "\(log.prCount) PRs", color: FC.yellow, systemImage: "medal.fill") }
            }
            Text("Logged \(DateText.day(log.performedOn, in: model.timeZone))\(log.rpe.map { " · RPE \(Format.number($0))" } ?? "")").font(.subheadline)
            if let notes = log.notes, !notes.isEmpty { Text("“\(notes)”").font(.footnote).italic().foregroundStyle(FC.label2) }
            ForEach(log.coachFeedback) { feedback in
                VStack(alignment: .leading, spacing: 4) {
                    Chip(text: "Coach feedback", color: FC.red)
                    Text(feedback.body).font(.subheadline)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FC.bg3, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }
}

/// One lettered block of a workout.
private struct BlockCard: View {
    let index: Int
    let item: WorkoutItem
    let scaled: Bool
    let entries: [LogEntry]
    let openVideo: (URL) -> Void

    private static let colors: [Color] = [FC.red, FC.red, FC.orange, FC.indigo, FC.green, FC.yellow]

    var body: some View {
        let color = Self.colors[index % Self.colors.count]
        let video = item.videoUrl.flatMap(URL.init(string:)).flatMap { $0.scheme?.hasPrefix("http") == true ? $0 : nil }
        FCard {
            HStack(alignment: .top, spacing: 12) {
                Text(String(UnicodeScalar(UInt8(65 + index % 26))))
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(color)
                    .frame(width: 34, height: 34)
                    .background(color.opacity(0.2), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.headline)
                    if let section = item.section, !section.isEmpty { Text(section).font(.footnote).foregroundStyle(FC.label2) }
                }
                Spacer(minLength: 8)
                if let video {
                    Button { openVideo(video) } label: {
                        Image(systemName: "play.fill").font(.footnote).frame(width: 52, height: 36).background(FC.bg3, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Watch \(item.title) video")
                }
            }
            if scaled, let scaling = item.scaling, !scaling.isEmpty {
                Text(scaling).font(.body)
            } else if let prescription = item.prescription, !prescription.isEmpty {
                Text(prescription).font(.body)
            }
            if let notes = item.notes, !notes.isEmpty {
                Label(notes, systemImage: "chevron.right").font(.subheadline).foregroundStyle(FC.label2)
            }
            if !entries.isEmpty {
                FC.separator.frame(height: 0.5)
                ForEach(entries) { entry in
                    HStack {
                        Text(Format.summary(of: entry)).font(.footnote.monospacedDigit())
                        if entry.isPr { Chip(text: "PR", color: FC.yellow, systemImage: "medal.fill") }
                    }
                }
            } else if !item.recordedMetrics.isEmpty {
                HStack(spacing: 6) {
                    ForEach(item.recordedMetrics, id: \.self) { metric in
                        Text(metric.label).font(.caption.weight(.semibold)).padding(.horizontal, 10).frame(height: 24).background(FC.fill, in: Capsule())
                    }
                }
            }
        }
    }
}
