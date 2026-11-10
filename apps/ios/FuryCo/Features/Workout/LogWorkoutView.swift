import FuryCore
import SwiftUI

/// The logging form. Its fields are generated from the metrics the coach chose for each item,
/// and everything typed is saved on the device until it has been submitted.
struct LogWorkoutView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let workout: Workout
    let existing: WorkoutLog?
    let route: WorkoutRoute
    let onSaved: () -> Void

    @State private var draft: LogDraft?
    @State private var restored = false
    @State private var saving = false
    @State private var error: String?
    @State private var result: LogResult?

    var body: some View {
        NavigationStack {
            Form {
                if restored {
                    Section {
                        Label("Picked up where you left off.", systemImage: "arrow.uturn.backward.circle")
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                }
                if let draft {
                    ForEach(workout.items.filter { draft.items[$0.id] != nil }) { item in
                        itemSection(item, sets: draft.items[item.id] ?? [])
                    }
                    sessionSection
                }
                if let error {
                    Section { ErrorText(message: error) }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(workout.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await submit() } }.disabled(saving || draft == nil)
                }
            }
            .onAppear(perform: prepare)
            .onChange(of: draft) { _, newValue in
                // Saved as you type, so a dropped connection or a phone call loses nothing.
                if let newValue, newValue.hasContent { model.drafts.save(newValue) }
            }
            .alert(prTitle, isPresented: Binding(get: { result != nil }, set: { if !$0 { finish() } })) {
                Button("Nice") { finish() }
            } message: {
                Text(result?.prs.map(describe).joined(separator: "\n") ?? "")
            }
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

    // MARK: Sections

    private func itemSection(_ item: WorkoutItem, sets: [SetDraft]) -> some View {
        let multiple = LogForm.allowsMultipleSets(item)
        return Section {
            ForEach(sets.indices, id: \.self) { index in
                SetFields(
                    title: multiple ? "Set \(index + 1)" : nil,
                    metrics: item.recordedMetrics,
                    loadUnit: draft?.loadUnit ?? .lb,
                    entry: setBinding(item.id, index)
                )
                .swipeActions {
                    if sets.count > 1 {
                        Button("Remove", role: .destructive) { draft?.items[item.id]?.remove(at: index) }
                    }
                }
            }
            if multiple {
                Button {
                    // A new set starts from the previous one: most sets repeat the same load and reps.
                    var next = SetDraft()
                    if let last = sets.last {
                        next.load = last.load
                        next.reps = last.reps
                    }
                    draft?.items[item.id]?.append(next)
                } label: {
                    Label("Add set", systemImage: "plus.circle")
                }
            }
        } header: {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                if let prescription = item.prescription {
                    Text(prescription).font(.caption).textCase(nil).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private var sessionSection: some View {
        Section("Session") {
            DatePicker("Date", selection: performedOnBinding, in: ...Date(), displayedComponents: .date)
                .environment(\.timeZone, model.timeZone)
            if draft?.items.values.contains(where: { !$0.isEmpty }) == true, draft?.loadUnit != nil {
                Picker("Load unit", selection: Binding(get: { draft?.loadUnit ?? .lb }, set: { draft?.loadUnit = $0 })) {
                    ForEach(LoadUnit.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
            }
            LabeledContent("Overall RPE") {
                TextField("0–10", text: Binding(get: { draft?.rpe ?? "" }, set: { draft?.rpe = $0 }))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
            }
            TextField("Notes for you and your coach", text: Binding(get: { draft?.notes ?? "" }, set: { draft?.notes = $0 }), axis: .vertical)
                .lineLimit(2...6)
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
            if saved.prs.isEmpty {
                dismiss()
            } else {
                result = saved
            }
        } catch {
            // The draft stays on the device, so nothing typed is lost.
            self.error = "\(Backend.message(for: error)) Your entries are saved on this phone — try again when you have signal."
        }
    }

    private func finish() {
        result = nil
        dismiss()
    }

    private var prTitle: String {
        (result?.prs.count ?? 0) == 1 ? "New personal record" : "New personal records"
    }

    private func describe(_ pr: LogResult.PR) -> String {
        if let time = pr.timeSeconds { return "\(pr.title): \(Format.duration(time))" }
        if let kg = pr.loadKg {
            let unit = draft?.loadUnit ?? .lb
            let load = Format.load((unit.fromKilograms(kg) * 2).rounded() / 2, unit: unit.rawValue)
            return pr.reps.map { "\(pr.title): \(load) × \($0)" } ?? "\(pr.title): \(load)"
        }
        if let reps = pr.reps { return "\(pr.title): \(reps) reps" }
        return pr.title
    }
}

/// The inputs for one set, showing only the fields the coach asked for.
private struct SetFields: View {
    let title: String?
    let metrics: [Metric]
    let loadUnit: LoadUnit
    @Binding var entry: SetDraft

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { Text(title).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted) }
            if metrics.contains(.load) { field("Load", text: $entry.load, unit: loadUnit.rawValue, keyboard: .decimalPad) }
            if metrics.contains(.sets) { field("Sets", text: $entry.sets, keyboard: .numberPad) }
            if metrics.contains(.reps) { field("Reps", text: $entry.reps, keyboard: .numberPad) }
            if metrics.contains(.time) { field("Time", text: $entry.time, placeholder: "mm:ss", keyboard: .numbersAndPunctuation) }
            if metrics.contains(.distance) {
                HStack {
                    field("Distance", text: $entry.distance, keyboard: .decimalPad)
                    Picker("Distance unit", selection: $entry.distanceUnit) {
                        ForEach(DistanceUnit.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
            }
            if metrics.contains(.pace) {
                HStack {
                    field("Pace", text: $entry.pace, placeholder: "mm:ss", keyboard: .numbersAndPunctuation)
                    Picker("Pace per", selection: $entry.paceUnit) {
                        ForEach(["500m", "km", "mile"], id: \.self) { Text("/ \($0)").tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
            }
            if metrics.contains(.splits) { splits }
            if metrics.contains(.rpe) { field("RPE", text: $entry.rpe, placeholder: "0–10", keyboard: .decimalPad) }
            if metrics.contains(.comments) {
                TextField("Comments", text: $entry.comments, axis: .vertical).lineLimit(1...4)
            }
        }
        .padding(.vertical, 2)
    }

    private func field(_ label: String, text: Binding<String>, unit: String? = nil, placeholder: String = "—", keyboard: UIKeyboardType) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField(placeholder, text: text)
                .keyboardType(keyboard)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(maxWidth: 110)
                .accessibilityLabel(label)
            if let unit { Text(unit).foregroundStyle(Theme.muted) }
        }
    }

    private var splits: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Splits").foregroundStyle(.primary)
            ForEach(entry.splits.indices, id: \.self) { index in
                HStack {
                    Text("\(index + 1)").foregroundStyle(Theme.muted).frame(width: 22, alignment: .leading)
                    TextField("mm:ss", text: Binding(
                        get: { entry.splits.indices.contains(index) ? entry.splits[index] : "" },
                        set: { if entry.splits.indices.contains(index) { entry.splits[index] = $0 } }
                    ))
                    .keyboardType(.numbersAndPunctuation)
                    .monospacedDigit()
                    .accessibilityLabel("Split \(index + 1)")
                }
            }
            Button {
                entry.splits.append("")
            } label: {
                Label("Add split", systemImage: "plus").font(.footnote)
            }
            .buttonStyle(.borderless)
        }
    }
}
