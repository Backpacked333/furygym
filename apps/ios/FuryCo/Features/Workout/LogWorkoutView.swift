import FuryCore
import SwiftUI

/// The logging screen. Its fields are generated from the metrics the coach chose for each block,
/// and everything typed is saved on the device until it has been submitted.
struct LogWorkoutView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let workout: Workout
    let existing: WorkoutLog?
    let last: [UUID: LastPerformance]
    let route: WorkoutRoute
    let onSaved: () -> Void

    @State private var draft: LogDraft?
    @State private var restored = false
    @State private var saving = false
    @State private var error: String?
    @State private var completed: CompletedWorkout?

    var body: some View {
        if let completed {
            WorkoutCompleteView(result: completed, done: { dismiss() }, viewProgress: {
                dismiss()
                model.tab = .progress
            })
        } else {
            form
        }
    }

    private var form: some View {
        VStack(spacing: 0) {
            HStack {
                GlassIconButton(systemName: "xmark", label: "Close") { dismiss() }
                Spacer()
                VStack(spacing: 1) {
                    Text("Log results").font(.headline)
                    Text(workout.title).font(.caption).foregroundStyle(FC.label2).lineLimit(1)
                }
                Spacer()
                Button(saving ? "Saving" : "Save") { Task { await submit() } }
                    .buttonStyle(.fc(.glass, size: .medium, fullWidth: false))
                    .disabled(saving || draft == nil)
            }
            .padding(.horizontal, 16)
            .frame(height: 54)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if restored {
                        Label("Picked up where you left off.", systemImage: "arrow.uturn.backward.circle").font(.footnote).foregroundStyle(FC.label2)
                    }
                    if let draft {
                        ForEach(Array(workout.items.enumerated()), id: \.element.id) { index, item in
                            if let sets = draft.items[item.id] { blockCard(index: index, item: item, sets: sets) }
                        }
                        sessionCard
                    }
                    ErrorText(message: error)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .bottomBar {
                Button { Task { await submit() } } label: { Label(saving ? "Saving…" : "Finish & save", systemImage: "checkmark") }
                    .buttonStyle(.fcFilled)
                    .disabled(saving || draft == nil)
            }
        }
        .background(FC.bg.ignoresSafeArea())
        .onAppear(perform: prepare)
        .onChange(of: draft) { _, newValue in
            // Saved as you type, so a dropped connection or a phone call loses nothing.
            if let newValue, newValue.hasContent { model.drafts.save(newValue) }
        }
    }

    // MARK: Setup

    private func prepare() {
        guard draft == nil else { return }
        let key = LogDraft.key(workoutId: workout.id, enrollmentId: route.enrollmentID)
        if let saved = model.drafts.load(key: key), saved.hasContent {
            draft = saved
            restored = true
        } else if let existing {
            draft = LogForm.draft(from: existing, workout: workout, loadUnit: model.loadUnit)
        } else {
            // Gym workouts are logged on their own date; program sessions on the day they were done.
            let today = model.today
            let performedOn = route.enrollmentID == nil ? min(route.date, today) : today
            draft = LogForm.newDraft(for: workout, enrollmentId: route.enrollmentID, performedOn: performedOn, loadUnit: model.loadUnit)
        }
    }

    private func setBinding(_ itemID: UUID, _ index: Int) -> Binding<SetDraft> {
        Binding(
            get: {
                guard let sets = draft?.items[itemID], sets.indices.contains(index) else { return SetDraft() }
                return sets[index]
            },
            set: { newValue in
                guard var sets = draft?.items[itemID], sets.indices.contains(index) else { return }
                sets[index] = newValue
                draft?.items[itemID] = sets
                draft?.updatedAt = Date()
            }
        )
    }

    // MARK: Blocks

    private func blockCard(index: Int, item: WorkoutItem, sets: [SetDraft]) -> some View {
        let metrics = item.recordedMetrics
        let multiple = LogForm.allowsMultipleSets(item)
        let unit = draft?.loadUnit ?? .lb
        let letter = String(UnicodeScalar(UInt8(65 + index % 26)))
        return FCard {
            HStack(alignment: .firstTextBaseline) {
                Text("\(letter) · \(item.title)").font(.headline)
                Spacer()
                if item.isBenchmark {
                    Chip(text: "Benchmark", color: FC.orange)
                } else if let exerciseID = item.exerciseId, let previous = last[exerciseID] {
                    Text("Last: \(previous.label(unit: unit))").font(.footnote).foregroundStyle(FC.label2)
                }
            }

            if multiple {
                HStack(spacing: 8) {
                    Text("SET").frame(width: 34)
                    if metrics.contains(.load) { Text("LOAD").frame(maxWidth: .infinity) }
                    if metrics.contains(.reps) { Text("REPS").frame(maxWidth: .infinity) }
                    Color.clear.frame(width: 28)
                }
                .font(.caption2.weight(.bold))
                .foregroundStyle(FC.label2)
                ForEach(sets.indices, id: \.self) { setIndex in
                    let entry = setBinding(item.id, setIndex)
                    let filled = !entry.wrappedValue.isEmpty
                    HStack(spacing: 8) {
                        Text("\(setIndex + 1)").font(.headline.monospacedDigit()).foregroundStyle(FC.label2).frame(width: 34)
                        if metrics.contains(.load) { LogCell(text: entry.load, unit: unit.rawValue, keyboard: .decimalPad, label: "Set \(setIndex + 1) load") }
                        if metrics.contains(.reps) { LogCell(text: entry.reps, unit: nil, keyboard: .numberPad, label: "Set \(setIndex + 1) reps") }
                        Image(systemName: filled ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(filled ? FC.green : FC.label3)
                            .frame(width: 28)
                            .accessibilityHidden(true)
                    }
                }
                HStack {
                    Button {
                        // A new set starts from the previous one: most sets repeat the same load and reps.
                        var next = SetDraft()
                        if let previous = sets.last {
                            next.load = previous.load
                            next.reps = previous.reps
                        }
                        draft?.items[item.id]?.append(next)
                    } label: { Label("Add set", systemImage: "plus") }
                    .buttonStyle(.fc(.gray, size: .small, fullWidth: false))
                    if sets.count > 1 {
                        Button("Remove last") { draft?.items[item.id]?.removeLast() }
                            .buttonStyle(.fc(.destructive, size: .small, fullWidth: false))
                    }
                }
            } else {
                let entry = setBinding(item.id, 0)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], alignment: .leading, spacing: 10) {
                    if metrics.contains(.load) { LabeledCell(label: "Load", text: entry.load, unit: unit.rawValue, placeholder: "0", keyboard: .decimalPad) }
                    if metrics.contains(.sets) { LabeledCell(label: "Sets", text: entry.sets, unit: nil, placeholder: "0", keyboard: .numberPad) }
                    if metrics.contains(.reps) { LabeledCell(label: "Reps", text: entry.reps, unit: nil, placeholder: "0", keyboard: .numberPad) }
                    if metrics.contains(.time) { LabeledCell(label: "Time", text: entry.time, unit: "min", placeholder: "mm:ss", keyboard: .numbersAndPunctuation) }
                    if metrics.contains(.distance) { LabeledCell(label: "Distance", text: entry.distance, unit: entry.wrappedValue.distanceUnit.rawValue, placeholder: "0", keyboard: .decimalPad) }
                    if metrics.contains(.pace) { LabeledCell(label: "Pace / \(entry.wrappedValue.paceUnit)", text: entry.pace, unit: nil, placeholder: "mm:ss", keyboard: .numbersAndPunctuation) }
                }
                if metrics.contains(.distance) {
                    Picker("Distance unit", selection: entry.distanceUnit) {
                        ForEach(DistanceUnit.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                if metrics.contains(.pace) {
                    Picker("Pace per", selection: entry.paceUnit) {
                        ForEach(["500m", "km", "mile"], id: \.self) { Text("per \($0)").tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                if metrics.contains(.splits) { splits(entry) }
            }

            if metrics.contains(.rpe) {
                let top = setBinding(item.id, max(sets.count - 1, 0))
                RPEPicker(title: multiple ? "RPE · top set" : "RPE", value: top.rpe)
            }
            if metrics.contains(.comments) {
                let first = setBinding(item.id, 0)
                TextField("How did it feel? Notes for your coach", text: first.comments, axis: .vertical)
                    .lineLimit(2...4)
                    .padding(12)
                    .background(FC.bg3, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private func splits(_ entry: Binding<SetDraft>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Splits").font(.footnote.weight(.semibold)).foregroundStyle(FC.label2)
            ForEach(entry.wrappedValue.splits.indices, id: \.self) { index in
                LogCell(
                    text: Binding(
                        get: { entry.wrappedValue.splits.indices.contains(index) ? entry.wrappedValue.splits[index] : "" },
                        set: { if entry.wrappedValue.splits.indices.contains(index) { entry.wrappedValue.splits[index] = $0 } }
                    ),
                    unit: "#\(index + 1)", keyboard: .numbersAndPunctuation, label: "Split \(index + 1)", placeholder: "mm:ss"
                )
            }
            Button { entry.wrappedValue.splits.append("") } label: { Label("Add split", systemImage: "plus") }
                .buttonStyle(.fc(.gray, size: .small, fullWidth: false))
        }
    }

    private var sessionCard: some View {
        FCard {
            Text("Session").font(.headline)
            DatePicker("Date", selection: performedOnBinding, in: ...Date(), displayedComponents: .date)
                .environment(\.timeZone, model.timeZone)
            if workout.items.contains(where: { $0.recordedMetrics.contains(.load) }) {
                Picker("Load unit", selection: Binding(get: { draft?.loadUnit ?? .lb }, set: { draft?.loadUnit = $0 })) {
                    ForEach(LoadUnit.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            RPEPicker(title: "Overall RPE", value: Binding(get: { draft?.rpe ?? "" }, set: { draft?.rpe = $0 }))
            TextField("Notes for you and your coach", text: Binding(get: { draft?.notes ?? "" }, set: { draft?.notes = $0 }), axis: .vertical)
                .lineLimit(2...6)
                .padding(12)
                .background(FC.bg3, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var performedOnBinding: Binding<Date> {
        Binding(
            get: { (draft?.performedOn ?? model.today).noon(in: model.timeZone) },
            set: { draft?.performedOn = DayDate($0, in: model.timeZone) }
        )
    }

    // MARK: Submit

    private func submit() async {
        guard let draft else { return }
        error = nil
        let submission: LogSubmission
        switch LogForm.submission(from: draft, workout: workout) {
        case .success(let value): submission = value
        case .failure(let failure):
            error = failure.description
            return
        }

        saving = true
        defer { saving = false }
        do {
            let saved = try await model.backend.submitLog(workoutID: workout.id, enrollmentID: route.enrollmentID, performedOn: draft.performedOn, submission: submission)
            model.drafts.delete(key: draft.key)
            onSaved()
            let logs = (try? await model.backend.recentLogs(limit: 60)) ?? []
            completed = CompletedWorkout(
                title: workout.title, result: saved, submission: submission, unit: draft.loadUnit,
                weekStreak: WeeklyActivity.weekStreak(loggedDays: logs.map(\.performedOn), today: model.today)
            )
        } catch {
            // The draft stays on the device, so nothing typed is lost.
            self.error = "\(Backend.message(for: error)) Your entries are saved on this phone — try again when you have signal."
        }
    }
}

/// A compact numeric cell in the set table.
private struct LogCell: View {
    @Binding var text: String
    let unit: String?
    let keyboard: UIKeyboardType
    let label: String
    var placeholder = "—"

    var body: some View {
        HStack(spacing: 4) {
            TextField(placeholder, text: $text)
                .keyboardType(keyboard)
                .multilineTextAlignment(.center)
                .font(.headline.monospacedDigit())
                .accessibilityLabel(label)
            if let unit { Text(unit).font(.footnote).foregroundStyle(FC.label2) }
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: 44)
        .background(FC.bg3, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct LabeledCell: View {
    let label: String
    @Binding var text: String
    let unit: String?
    let placeholder: String
    let keyboard: UIKeyboardType

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(FC.label2)
            HStack {
                TextField(placeholder, text: $text).keyboardType(keyboard).font(.body.monospacedDigit()).accessibilityLabel(label)
                if let unit { Text(unit).foregroundStyle(FC.label2) }
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(FC.bg3, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}

/// Ten RPE chips; tapping the selected one clears it.
private struct RPEPicker: View {
    let title: String
    @Binding var value: String

    private static let words = [6: "Moderate", 7: "Solid", 8: "Hard", 9: "Very hard", 10: "Max"]

    var body: some View {
        let selected = Int(value)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title).font(.footnote.weight(.semibold)).foregroundStyle(FC.label2)
                Spacer()
                if let selected { Text([String(selected), Self.words[selected]].compactMap { $0 }.joined(separator: " · ")).font(.footnote.weight(.semibold)).foregroundStyle(FC.red) }
            }
            HStack(spacing: 4) {
                ForEach(1...10, id: \.self) { number in
                    Button { value = selected == number ? "" : String(number) } label: {
                        Text("\(number)")
                            .font(.footnote.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(selected == number ? FC.redFill : FC.bg3, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("RPE \(number)")
                    .accessibilityAddTraits(selected == number ? .isSelected : [])
                }
            }
        }
    }
}

/// What the workout-complete screen shows.
struct CompletedWorkout: Identifiable {
    let id = UUID()
    let title: String
    let result: LogResult
    let submission: LogSubmission
    let unit: LoadUnit
    let weekStreak: Int

    var volume: Double { TrainingMath.volume(of: submission.entries) }
    var time: Double? { submission.entries.compactMap(\.timeSeconds).max() }
    var averageRPE: Double? {
        let values = submission.entries.compactMap(\.rpe) + (submission.rpe.map { [$0] } ?? [])
        return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
    }
    var headlinePR: LogResult.PR? { result.prs.first }
}

struct WorkoutCompleteView: View {
    let result: CompletedWorkout
    let done: () -> Void
    let viewProgress: () -> Void

    var body: some View {
        let pr = result.headlinePR
        ScrollView {
            VStack(spacing: 18) {
                HStack {
                    Spacer()
                    Button("Done", action: done).buttonStyle(.fc(.glass, size: .medium, fullWidth: false))
                }
                Image(systemName: pr == nil ? "checkmark" : "medal.fill")
                    .font(.system(size: 38, weight: .bold))
                    .foregroundStyle(pr == nil ? FC.green : FC.yellow)
                    .frame(width: 88, height: 88)
                    .background((pr == nil ? FC.green : FC.yellow).opacity(0.2), in: Circle())
                    .padding(.top, 12)
                Eyebrow(text: pr == nil ? "Workout complete" : result.result.prs.count == 1 ? "New personal record" : "\(result.result.prs.count) new personal records", color: pr == nil ? FC.green : FC.yellow)

                if let pr {
                    headline(pr)
                    Text(pr.title).font(.body).foregroundStyle(FC.label2)
                } else {
                    Text(result.title).font(.title.bold()).multilineTextAlignment(.center)
                }

                HStack(spacing: 10) {
                    if result.volume > 0 { tile("Volume", Format.number(result.volume.rounded()), result.unit.rawValue) }
                    if let time = result.time { tile("Time", Format.duration(time), "min") }
                    if let rpe = result.averageRPE { tile("RPE", Format.number((rpe * 10).rounded() / 10), "avg") }
                }

                ListGroup {
                    if let pr, let kg = pr.loadKg {
                        ListRow(systemImage: "chart.line.uptrend.xyaxis", iconColor: FC.green, title: "Est. 1RM",
                                value: Format.load(TrainingMath.displayLoad(kilograms: TrainingMath.estimatedOneRepMax(load: kg, reps: pr.reps), unit: result.unit), unit: result.unit.rawValue), showChevron: false)
                    }
                    ListRow(systemImage: "flame.fill", iconColor: FC.redFill, title: "Week streak", value: result.weekStreak == 1 ? "1 week" : "\(result.weekStreak) weeks", showChevron: false)
                    ListRow(systemImage: "bubble.left.and.bubble.right.fill", title: "Coach review", subtitle: "Feedback appears on this workout when your coach replies", showChevron: false, isLast: true)
                }

                Button("View progress", action: viewProgress).buttonStyle(.fcFilled)
            }
            .padding(16)
        }
        .background(
            ZStack {
                FC.bg
                RadialGradient(colors: [(pr == nil ? FC.green : FC.yellow).opacity(0.22), .clear], center: .top, startRadius: 0, endRadius: 360)
            }
            .ignoresSafeArea()
        )
    }

    @ViewBuilder private func headline(_ pr: LogResult.PR) -> some View {
        if let time = pr.timeSeconds {
            Text(Format.duration(time)).font(FC.metric(56))
        } else if let kg = pr.loadKg {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Format.number(TrainingMath.displayLoad(kilograms: kg, unit: result.unit))).font(FC.metric(56))
                Text("\(result.unit.rawValue)\(pr.reps.map { " × \($0)" } ?? "")").font(.title2.weight(.semibold)).foregroundStyle(FC.label2)
            }
        } else if let reps = pr.reps {
            Text("\(reps) reps").font(FC.metric(56))
        }
    }

    private func tile(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.footnote).foregroundStyle(FC.label2)
            Text(value).font(FC.metric(22))
            Text(unit).font(.footnote).foregroundStyle(FC.label2)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FC.bg2, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
