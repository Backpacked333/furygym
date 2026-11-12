import FuryCore
import SwiftUI

/// The online program catalogue.
struct ProgramsView: View {
    private struct Snapshot {
        var programs: [Program]
        var enrollments: [Enrollment]
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var isRootOfFlow = false

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: load) { snapshot in
            let owned = Set(snapshot.enrollments.filter { $0.status == .active }.map(\.programId))
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Train anywhere", title: "Programs")
                    if let featured = snapshot.programs.first {
                        NavigationLink(value: featured) {
                            ZStack(alignment: .bottomLeading) {
                                HeroBackdrop().frame(height: 270)
                                VStack(alignment: .leading, spacing: 8) {
                                    Chip(text: owned.contains(featured.id) ? "Enrolled" : "Featured", color: FC.indigo, solid: true)
                                    Text(featured.name).font(.title.bold()).multilineTextAlignment(.leading)
                                    Text("\(featured.durationWeeks) weeks · \(featured.daysPerWeek) days/wk").font(.subheadline).foregroundStyle(FC.label2)
                                }
                                .padding(18)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                    GroupTitle(text: "All programs").padding(.top, 4)
                    if snapshot.programs.isEmpty {
                        FCard { Text("Programs are coming soon.").foregroundStyle(FC.label2) }
                    }
                    ForEach(snapshot.programs) { program in
                        NavigationLink(value: program) {
                            HStack(spacing: 14) {
                                HeroBackdrop().frame(width: 76, height: 76).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(program.name).font(.headline).multilineTextAlignment(.leading)
                                    Text("\(program.durationWeeks) weeks · \(program.daysPerWeek) days/wk").font(.footnote).foregroundStyle(FC.label2)
                                }
                                Spacer(minLength: 6)
                                if owned.contains(program.id) {
                                    Chip(text: "Enrolled", color: FC.green)
                                } else {
                                    Text(Format.money(cents: program.priceCents, currency: program.currency).replacingOccurrences(of: ".00", with: "")).font(.headline.monospacedDigit())
                                }
                            }
                            .padding(12)
                            .background(FC.bg2, in: RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .navigationDestination(for: Program.self) { program in
                ProgramDetailView(program: program, enrollment: snapshot.enrollments.first { $0.programId == program.id && $0.status == .active })
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                GlassIconButton(systemName: isRootOfFlow ? "xmark" : "chevron.left", label: isRootOfFlow ? "Close" : "Back") {
                    if isRootOfFlow { model.flow = nil } else { dismiss() }
                }
            }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    private func load() async throws -> Snapshot {
        async let programs = model.backend.programs()
        async let enrollments = model.backend.enrollments()
        return Snapshot(programs: try await programs, enrollments: (try? await enrollments) ?? [])
    }
}

/// A program's pitch, its rules, and the path to enrol.
struct ProgramDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let program: Program
    let enrollment: Enrollment?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ZStack(alignment: .bottomLeading) {
                    HeroBackdrop().frame(height: 250)
                    VStack(alignment: .leading, spacing: 8) {
                        Chip(text: "Online program", color: FC.indigo, dot: true)
                        Text(program.name).font(.title.bold())
                        if let summary = program.summary { Text(summary).font(.subheadline).foregroundStyle(FC.label2) }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                }
                .padding(.horizontal, -16)

                HStack(spacing: 10) {
                    fact("\(program.durationWeeks)", "weeks")
                    fact("\(program.daysPerWeek)", "days / week")
                    fact("\(program.durationWeeks * program.daysPerWeek)", "sessions")
                }
                if let description = program.description, !description.isEmpty {
                    Text(description).font(.subheadline).foregroundStyle(FC.label2).padding(.horizontal, 4)
                }
                ListGroup {
                    ListRow(systemImage: "calendar", iconColor: FC.indigo, title: "Start any day", subtitle: "Your calendar is built from your own start date", showChevron: false)
                    ListRow(systemImage: "lock.open.fill", iconColor: FC.redFill, title: unlockTitle, subtitle: "Missed sessions stay available", showChevron: false)
                    ListRow(systemImage: "clock.arrow.circlepath", title: "Access after the final week", value: "\(program.graceDays) days", showChevron: false, isLast: true)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .ignoresSafeArea(edges: .top)
        .screenBackground()
        .bottomBar { footer }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { GlassIconButton(systemName: "chevron.left", label: "Back") { dismiss() } }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationDestination(for: StartDateRoute.self) { StartDateView(program: $0.program) }
    }

    private var unlockTitle: String {
        switch program.unlockMode {
        case .daily: return "Sessions unlock day by day"
        case .all: return "Every session open from day one"
        default: return "Each week unlocks on its first day"
        }
    }

    private func fact(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(FC.metric(22))
            Text(label).font(.footnote).foregroundStyle(FC.label2)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FC.bg2, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    @ViewBuilder private var footer: some View {
        if let enrollment {
            NavigationLink(value: AccountRoute.program(enrollment.id)) { Text("View your plan").frame(maxWidth: .infinity) }.buttonStyle(.fcFilled)
        } else if model.showsProgramPurchaseLink {
            HStack(spacing: 14) {
                Text(Format.money(cents: program.priceCents, currency: program.currency).replacingOccurrences(of: ".00", with: "")).font(FC.metric(22))
                NavigationLink(value: StartDateRoute(program: program)) { Text("Choose start date").frame(maxWidth: .infinity) }.buttonStyle(.fcFilled)
            }
        } else {
            // Outside the US storefront the app shows programs but does not sell or link to them.
            Text("Enrolment for this program is handled outside the app.").font(.footnote).foregroundStyle(FC.label2).frame(maxWidth: .infinity, minHeight: 50)
        }
    }
}

struct StartDateRoute: Hashable {
    let program: Program
}

/// Pick day one, see exactly what the rules will be, then continue to payment on the web.
struct StartDateView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let program: Program

    @State private var date = Date()
    @State private var confirming = false
    @State private var working = false
    @State private var error: String?

    private var start: DayDate { DayDate(date, in: model.timeZone) }
    private var accessEnds: DayDate { start.adding(days: program.durationWeeks * 7 - 1 + program.graceDays) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                FCard(padding: 8) {
                    DatePicker("Start date", selection: $date, in: Date()...Date().addingTimeInterval(90 * 86_400), displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .tint(FC.redFill)
                        .environment(\.timeZone, model.timeZone)
                }
                ListGroup {
                    ListRow(systemImage: "lock.fill", iconColor: FC.redFill, title: program.unlockMode == .daily ? "Workouts unlock daily" : program.unlockMode == .all ? "Everything opens on day one" : "Workouts unlock weekly", showChevron: false)
                    ListRow(systemImage: "clock.arrow.circlepath", title: "Missed days stay open", showChevron: false)
                    ListRow(systemImage: "calendar.badge.clock", title: "You can move your start", value: "until day 1", showChevron: false)
                    ListRow(systemImage: "calendar.badge.exclamationmark", title: "Access ends", value: DateText.date(accessEnds.noon(in: model.timeZone), in: model.timeZone), showChevron: false, isLast: true)
                }
                Text("Week 1 · \(DateText.day(start, in: model.timeZone)) → \(DateText.day(start.adding(days: 6), in: model.timeZone))")
                    .font(.footnote).foregroundStyle(FC.label2).frame(maxWidth: .infinity)
                ErrorText(message: error)
            }
            .padding(16)
        }
        .screenBackground()
        .bottomBar { Button("Continue") { confirming = true }.buttonStyle(.fcFilled) }
        .navigationTitle("Start date")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { GlassIconButton(systemName: "chevron.left", label: "Back") { dismiss() } }
        }
        .sheet(isPresented: $confirming) { confirmSheet.fcSheet(height: 400) }
    }

    private var confirmSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Confirm purchase").font(.title2.bold()).padding(.top, 8)
            HStack(spacing: 12) {
                HeroBackdrop().frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(program.name)").font(.headline)
                    Text("Starts \(DateText.day(start, in: model.timeZone)) · access to \(DateText.shortDay(accessEnds, in: model.timeZone))").font(.footnote).foregroundStyle(FC.label2)
                }
            }
            FCard {
                HStack {
                    Text("Total").fontWeight(.semibold)
                    Spacer()
                    Text(Format.money(cents: program.priceCents, currency: program.currency)).fontWeight(.semibold).monospacedDigit()
                }
                Text("One-time purchase. Tax, if any, is added at payment.").font(.footnote).foregroundStyle(FC.label2)
            }
            Button(working ? "Opening…" : "Continue on the web") { Task { await purchase() } }
                .buttonStyle(.fc(.white))
                .disabled(working)
            Text("Payment is completed on the Fury Co. website in your browser. Your plan appears here as soon as it is paid.")
                .font(.footnote).foregroundStyle(FC.label2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }

    private func purchase() async {
        working = true
        defer { working = false }
        do {
            let url = try await model.backend.checkoutURL(for: .program(program.id, start: start))
            confirming = false
            // Digital programs are paid for in the browser, outside the app.
            openURL(url)
        } catch {
            confirming = false
            self.error = Backend.message(for: error)
        }
    }
}

/// "You're enrolled": the personal week-by-week plan, with what is open and what is still locked.
struct ProgramPlanView: View {
    private struct Snapshot {
        var enrollment: Enrollment
        var entries: [CalendarEntry]
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let enrollmentID: UUID
    @State private var editingStart = false

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: load) { snapshot in
            let enrollment = snapshot.enrollment
            let done = snapshot.entries.filter(\.isCompleted).count
            let weeks = Dictionary(grouping: snapshot.entries, by: { $0.week ?? 0 })
            let phase = ProgramSchedule.phase(start: enrollment.startDate, expiresAt: enrollment.expiresAt, durationWeeks: enrollment.programs?.durationWeeks ?? 0, today: model.today)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 16) {
                        Ring(progress: snapshot.entries.isEmpty ? 0 : Double(done) / Double(snapshot.entries.count), size: 76, lineWidth: 8, color: FC.indigo) {
                            Text("\(done)/\(snapshot.entries.count)").font(.footnote.weight(.bold)).monospacedDigit()
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Eyebrow(text: "You’re enrolled", color: FC.indigo)
                            Text(enrollment.programs?.name ?? "Program").font(.title2.bold())
                            Text(describe(phase, enrollment)).font(.subheadline).foregroundStyle(FC.label2)
                        }
                    }
                    .padding(.bottom, 6)

                    if case .upcoming = phase {
                        Button("Change start date") { editingStart = true }.buttonStyle(.fc(.gray, size: .medium, fullWidth: false))
                    }

                    ForEach(weeks.keys.sorted(), id: \.self) { week in
                        let days = (weeks[week] ?? []).sorted { ($0.day ?? 0) < ($1.day ?? 0) }
                        let locked = days.allSatisfy(\.locked)
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Week \(week)").font(.headline)
                                    if let first = days.first, let last = days.last {
                                        Text("\(DateText.shortDay(first.calendarDate, in: model.timeZone)) – \(DateText.shortDay(last.calendarDate, in: model.timeZone)) · \(days.count) sessions")
                                            .font(.footnote).foregroundStyle(FC.label2)
                                    }
                                }
                                Spacer()
                                if locked {
                                    Image(systemName: "lock.fill").foregroundStyle(FC.label3).accessibilityLabel("Locked")
                                } else {
                                    Chip(text: "\(days.filter(\.isCompleted).count)/\(days.count)", color: FC.indigo)
                                }
                            }
                            if !locked {
                                ForEach(days) { EntryRow(entry: $0, highlighted: $0.calendarDate == model.today && !$0.isCompleted) }
                            }
                        }
                        .padding(16)
                        .background(locked ? FC.bg2.opacity(0.6) : FC.bg2, in: RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .sheet(isPresented: $editingStart) { StartDateSheet(enrollment: enrollment).fcSheet(height: 560) }
        }
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { GlassIconButton(systemName: "chevron.left", label: "Back") { dismiss() } }
        }
        .navigationDestination(for: WorkoutRoute.self) { WorkoutDetailView(route: $0) }
    }

    private func load() async throws -> Snapshot {
        let enrollments = try await model.backend.enrollments()
        guard let enrollment = enrollments.first(where: { $0.id == enrollmentID }) else { throw Backend.WebError(message: "This program is no longer on your account.") }
        let weeks = enrollment.programs?.durationWeeks ?? 12
        let entries = try await model.backend.calendar(from: enrollment.startDate, to: enrollment.startDate.adding(days: weeks * 7))
        return Snapshot(enrollment: enrollment, entries: entries.filter { $0.enrollmentId == enrollmentID })
    }

    private func describe(_ phase: ProgramSchedule.Phase, _ enrollment: Enrollment) -> String {
        switch phase {
        case .upcoming: return "Week 1 starts \(DateText.day(enrollment.startDate, in: model.timeZone))"
        case .inProgress(let week, let total): return "Week \(week) of \(total)"
        case .finished(let left): return "Complete · \(left) days of access left"
        case .expired: return "Access has ended"
        }
    }
}

private struct StartDateSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let enrollment: Enrollment
    @State private var date = Date()
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Change start date").font(.title2.bold()).padding(.top, 8)
            DatePicker("Start date", selection: $date, in: Date()...Date().addingTimeInterval(90 * 86_400), displayedComponents: .date)
                .datePickerStyle(.graphical)
                .tint(FC.redFill)
                .environment(\.timeZone, model.timeZone)
            ErrorText(message: error)
            Button(saving ? "Saving…" : "Save start date") { Task { await save() } }.buttonStyle(.fcFilled).disabled(saving)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .onAppear { date = enrollment.startDate.noon(in: model.timeZone) }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await model.backend.setStartDate(enrollmentID: enrollment.id, to: DayDate(date, in: model.timeZone))
            model.didChange()
            dismiss()
        } catch {
            self.error = Backend.message(for: error)
        }
    }
}
