import EventKit
import FuryCore
import SwiftUI

/// The class schedule: a day strip, track filters, and one row per class.
struct ClassesView: View {
    @Environment(AppModel.self) private var model
    @State private var selectedDay: DayDate?
    @State private var track: String?

    private var day: DayDate { selectedDay ?? model.today }
    private var window: Int { min(max(model.gym?.bookingWindowDays ?? 14, 1), 28) }

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: load) { sessions in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: model.gym?.name, title: "Classes").padding(.top, 8)
                    dayStrip(sessions)
                    filters(sessions)

                    let todays = sessions.filter { DayDate($0.startsAt, in: model.timeZone) == day && (track == nil || $0.trackName == track) }
                    if todays.isEmpty {
                        FCard { Text("No classes on \(DateText.day(day, in: model.timeZone)).").foregroundStyle(FC.label2) }
                    } else {
                        ListGroup {
                            ForEach(Array(todays.enumerated()), id: \.element.id) { index, session in
                                NavigationLink(value: session) { ClassRow(session: session, isLast: index == todays.count - 1) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                    Text(model.entitlements.headline).font(.footnote).foregroundStyle(FC.label2).padding(.horizontal, 4)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .screenBackground()
            .withTabBar()
        }
        .navigationDestination(for: ClassSession.self) { ClassDetailView(session: $0) }
        .navigationDestination(for: AccountRoute.self) { $0.destination }
        .navigationDestination(for: WorkoutRoute.self) { WorkoutDetailView(route: $0) }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func load() async throws -> [ClassSession] {
        let start = model.today.noon(in: model.timeZone).addingTimeInterval(-12 * 3600)
        let sessions = try await model.backend.classes(from: start, to: start.addingTimeInterval(Double(window + 1) * 86_400))
        try await model.refreshBookingAccess()
        return sessions
    }

    private func dayStrip(_ sessions: [ClassSession]) -> some View {
        let booked = Set(sessions.filter { $0.myBookingStatus == .booked || $0.myBookingStatus == .waitlisted }.map { DayDate($0.startsAt, in: model.timeZone) })
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(0...window, id: \.self) { offset in
                    let date = model.today.adding(days: offset)
                    let active = date == day
                    Button { selectedDay = date } label: {
                        VStack(spacing: 4) {
                            Text(DateText.weekdayInitial(date, in: model.timeZone)).font(.caption2.weight(.semibold)).foregroundStyle(active ? .white : FC.label2)
                            Text("\(date.day)").font(.title3.weight(.semibold))
                            Circle().fill(booked.contains(date) ? (active ? Color.white : FC.green) : .clear).frame(width: 4, height: 4)
                        }
                        .frame(width: 46, height: 66)
                        .background(active ? FC.redFill : FC.bg2, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(DateText.longDay(date, in: model.timeZone) + (booked.contains(date) ? ", booked" : ""))
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
        }
    }

    private func filters(_ sessions: [ClassSession]) -> some View {
        var seen = Set<String>()
        let tracks = sessions.compactMap { s -> (String, String?)? in
            guard let name = s.trackName, seen.insert(name).inserted else { return nil }
            return (name, s.trackColor)
        }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button { track = nil } label: { Chip(text: "All", color: track == nil ? .white : FC.label2) }.buttonStyle(.plain)
                ForEach(tracks, id: \.0) { name, color in
                    Button { track = track == name ? nil : name } label: {
                        Chip(text: name, color: Color(hex: color), dot: true, solid: track == name)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(track == name ? .isSelected : [])
                }
            }
        }
    }
}

private struct ClassRow: View {
    @Environment(AppModel.self) private var model
    let session: ClassSession
    let isLast: Bool

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(DateText.time(session.startsAt, in: model.timeZone))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text("\(session.durationMinutes) min").font(.footnote).foregroundStyle(FC.label2)
            }
            .frame(width: 72, alignment: .leading)
            Capsule().fill(Color(hex: session.trackColor)).frame(width: 3, height: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(session.title).font(.body.weight(.medium)).lineLimit(2)
                if let coach = session.coachName { Text("Coach \(coach)").font(.footnote).foregroundStyle(FC.label2) }
                CapacityBar(booked: session.bookedCount, capacity: session.capacity)
            }
            Spacer(minLength: 6)
            status
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .opacity(session.status == "cancelled" ? 0.4 : 1)
        .overlay(alignment: .bottom) { if !isLast { FC.separator.frame(height: 0.5).padding(.leading, 16) } }
        .contentShape(Rectangle())
    }

    @ViewBuilder private var status: some View {
        let action = ClassBooking.action(for: session, now: Date(), cancelCutoffMinutes: model.gym?.cancelCutoffMinutes ?? 60, bookingWindowDays: model.gym?.bookingWindowDays ?? 14)
        switch (session.myBookingStatus, action) {
        case _ where session.status == "cancelled": Text(session.myClassCancelled == true ? "Cancelled\nYou were booked" : "Cancelled").font(.footnote.weight(.semibold)).foregroundStyle(FC.label2).multilineTextAlignment(.trailing).fixedSize()
        case (.booked, _): Chip(text: "Booked", color: FC.green, systemImage: "checkmark")
        case (.attended, _): Chip(text: "Attended", color: FC.green, systemImage: "checkmark")
        case (.waitlisted, _): Chip(text: session.myWaitlistPosition.map { "Waitlist #\($0)" } ?? "Waitlisted", color: FC.orange)
        case (_, .book): Text("Reserve").font(.footnote.weight(.semibold)).foregroundStyle(FC.redHi).padding(.horizontal, 12).frame(height: 28).background(FC.red.opacity(0.16), in: Capsule())
        case (_, .joinWaitlist): Text("Waitlist").font(.footnote.weight(.semibold)).padding(.horizontal, 12).frame(height: 28).background(FC.fill, in: Capsule())
        case (_, .unavailable(let reason)): Text(reason).font(.footnote).foregroundStyle(FC.label3)
        default: EmptyView()
        }
    }
}

/// One class: who is coaching, how full it is, the day's workout, and the booking action.
struct ClassDetailView: View {
    private enum SheetKind: String, Identifiable {
        case reserve, waitlist
        var id: String { rawValue }
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let session: ClassSession

    @State private var current: ClassSession?
    @State private var preview: Workout?
    @State private var sheet: SheetKind?
    @State private var working = false
    @State private var refreshing = false
    @State private var accessReady = false
    @State private var refreshTask = ViewRefreshTask<Bool>()
    @State private var error: String?
    @State private var confirmCancel = false

    private var live: ClassSession { current ?? session }
    private var action: BookingAction {
        ClassBooking.action(for: live, now: Date(), cancelCutoffMinutes: model.gym?.cancelCutoffMinutes ?? 60, bookingWindowDays: model.gym?.bookingWindowDays ?? 14)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ZStack(alignment: .bottomLeading) {
                    HeroBackdrop(tint: Color(hex: live.trackColor)).frame(height: 250)
                    VStack(alignment: .leading, spacing: 8) {
                        TrackChip(name: live.trackName, hex: live.trackColor)
                        Text("\(live.title) · \(DateText.time(live.startsAt, in: model.timeZone))").font(.title.bold())
                        Text("\(DateText.day(DayDate(live.startsAt, in: model.timeZone), in: model.timeZone)) · \(live.durationMinutes) min")
                            .font(.subheadline).foregroundStyle(FC.label2)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                }
                .padding(.horizontal, -16)

                FCard {
                    HStack(spacing: 12) {
                        Text(initials(live.coachName)).font(.subheadline.weight(.bold)).frame(width: 44, height: 44).background(FC.redFill.opacity(0.45), in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(live.coachName.map { "Coach \($0)" } ?? "Coach to be confirmed").font(.headline)
                            Text(ClassBooking.spotsLabel(for: live)).font(.footnote).foregroundStyle(FC.label2)
                        }
                        Spacer()
                        Text("\(live.bookedCount)/\(live.capacity)").font(.subheadline.monospacedDigit()).foregroundStyle(live.isFull ? FC.orange : FC.label2)
                    }
                }

                if let preview {
                    NavigationLink(value: WorkoutRoute(workoutID: preview.id, enrollmentID: nil, title: preview.title, date: DayDate(live.startsAt, in: model.timeZone))) {
                        FCard {
                            HStack {
                                Text("Workout preview").font(.headline)
                                Spacer()
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(FC.label3)
                            }
                            Text(preview.title).font(.subheadline.weight(.semibold))
                            ForEach(preview.items.prefix(4)) { item in
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    Circle().fill(Color(hex: live.trackColor)).frame(width: 5, height: 5)
                                    Text([item.title, item.prescription].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).lineLimit(2)
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }

                Label(policy, systemImage: "info.circle").font(.footnote).foregroundStyle(FC.label2).padding(.horizontal, 4)
                ErrorText(message: error)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .ignoresSafeArea(edges: .top)
        .screenBackground()
        .bottomBar { actionButton }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { GlassIconButton(systemName: "chevron.left", label: "Back") { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                GlassIconButton(systemName: "arrow.clockwise", label: "Refresh class") { Task { await reload() } }
                    .disabled(refreshing || working)
            }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { _ = await reload() }
        .onDisappear { refreshTask.cancel() }
        .sheet(item: $sheet) { kind in
            switch kind {
            case .reserve: ReserveSheet(session: live) { addToCalendar in await book(addToCalendar: addToCalendar) }.fcSheet(height: 430)
            case .waitlist: WaitlistSheet(session: live) { await book(addToCalendar: false) }.fcSheet(height: 400)
            }
        }
        .confirmationDialog("Cancel this late?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel my booking", role: .destructive) { Task { await cancel() } }
            Button("Keep my place", role: .cancel) {}
        } message: {
            Text("Free cancellation has closed. If you booked with a class credit, it will not be returned.")
        }
    }

    private var policy: String {
        let cutoff = live.startsAt.addingTimeInterval(-Double(model.gym?.cancelCutoffMinutes ?? 60) * 60)
        return "Cancel free until \(DateText.time(cutoff, in: model.timeZone)). A late cancel uses a class credit."
    }

    private func initials(_ name: String?) -> String {
        let parts = (name ?? "").split(separator: " ").prefix(2).compactMap { $0.first }
        return parts.isEmpty ? "FC" : String(parts).uppercased()
    }

    @ViewBuilder private var actionButton: some View {
        if refreshing {
            ProgressView("Checking access…").frame(maxWidth: .infinity, minHeight: 50)
        } else if !accessReady {
            Button("Retry") { Task { await reload() } }.buttonStyle(.fc(.gray))
        } else {
            switch action {
            case .book, .joinWaitlist:
                if model.needsWaiver {
                    NavigationLink(value: AccountRoute.waiver) { Text("Sign waiver to book").frame(maxWidth: .infinity) }.buttonStyle(.fc(.gray))
                } else if !model.entitlements.canBookClasses {
                    Button("Get a membership to book") { model.flow = .joinGym }.buttonStyle(.fc(.gray))
                } else {
                    Button(action == .book ? "Reserve spot" : "Join waitlist") { Task { await prepareReservation() } }
                        .buttonStyle(.fcFilled)
                        .disabled(working)
                }
            case .cancel(let late):
                Button { model.tab = .checkIn } label: { Label("Check in", systemImage: "qrcode") }.buttonStyle(.fcFilled)
                Button(working ? "Cancelling…" : "Cancel booking") { if late { confirmCancel = true } else { Task { await cancel() } } }
                    .buttonStyle(.fc(.gray))
                    .disabled(working)
            case .leaveWaitlist(let position):
                Button(working ? "Leaving…" : "Leave waitlist\(position.map { " (#\($0))" } ?? "")") { Task { await cancel() } }
                    .buttonStyle(.fc(.gray))
                    .disabled(working)
            case .unavailable(let reason):
                Text(reason).font(.headline).foregroundStyle(FC.label2).frame(maxWidth: .infinity, minHeight: 50)
            }
        }
    }

    @discardableResult
    private func reload() async -> Bool {
        await refreshTask.run { await refresh() }
    }

    private func refresh() async -> Bool {
        refreshing = true
        defer { refreshing = false }
        let start = live.startsAt.addingTimeInterval(-60)
        do {
            guard let fresh = try await model.backend.classes(from: start, to: start.addingTimeInterval(120)).first(where: { $0.id == session.id }) else {
                throw Backend.WebError(message: "This class is no longer available.")
            }
            try await model.refreshBookingAccess()
            current = fresh
            accessReady = true
            error = nil
        } catch is CancellationError {
            return false
        } catch {
            if Task.isCancelled { return false }
            accessReady = false
            preview = nil
            self.error = Backend.message(for: error)
            return false
        }
        if preview == nil, let trackID = live.trackId {
            preview = try? await model.backend.workouts(on: DayDate(live.startsAt, in: model.timeZone), trackID: trackID).first
        }
        return true
    }

    private func prepareReservation() async {
        working = true
        defer { working = false }
        guard await reload(), !model.needsWaiver, model.entitlements.canBookClasses else { return }
        switch action {
        case .book: sheet = .reserve
        case .joinWaitlist: sheet = .waitlist
        default: break
        }
    }

    private func book(addToCalendar: Bool) async {
        working = true
        error = nil
        defer { working = false }
        do {
            let status = try await model.backend.book(sessionID: session.id)
            sheet = nil
            if status == .booked {
                await Reminders.schedule(for: live, timeZone: model.timeZone)
                if addToCalendar { await CalendarExport.add(live) }
            }
            await model.refreshAccount()
            model.didChange()
            await reload()
        } catch {
            sheet = nil
            self.error = Backend.message(for: error)
        }
    }

    private func cancel() async {
        guard let bookingID = live.myBookingId else { return }
        working = true
        error = nil
        defer { working = false }
        do {
            try await model.backend.cancelBooking(id: bookingID)
            Reminders.cancel(for: session.id)
            await model.refreshAccount()
            model.didChange()
            await reload()
        } catch {
            self.error = Backend.message(for: error)
        }
    }
}

/// Shows what the booking will draw on and the cancellation window before committing.
private struct ReserveSheet: View {
    @Environment(AppModel.self) private var model
    let session: ClassSession
    let confirm: (Bool) async -> Void
    @State private var addToCalendar = false
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Reserve your spot").font(.title2.bold()).padding(.top, 8)
            HStack(spacing: 12) {
                Capsule().fill(Color(hex: session.trackColor)).frame(width: 4, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(session.title) · \(DateText.time(session.startsAt, in: model.timeZone))").font(.headline)
                    Text([DateText.day(DayDate(session.startsAt, in: model.timeZone), in: model.timeZone), session.coachName.map { "Coach \($0)" }].compactMap { $0 }.joined(separator: " · "))
                        .font(.footnote).foregroundStyle(FC.label2)
                }
            }
            ListGroup {
                ListRow(
                    systemImage: "creditcard.fill", iconColor: FC.redFill,
                    title: model.memberships.first(where: \.isLive)?.planName ?? "Membership",
                    subtitle: model.entitlements.unlimited ? "Included · no credit used" : "Uses 1 class credit · \(max(model.entitlements.classCredits - 1, 0)) left after",
                    showChevron: false
                )
                Toggle(isOn: $addToCalendar) {
                    Label("Add to calendar", systemImage: "calendar.badge.plus").font(.body)
                }
                .tint(FC.redFill)
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
            }
            Label("Free cancellation until \(DateText.time(session.startsAt.addingTimeInterval(-Double(model.gym?.cancelCutoffMinutes ?? 60) * 60), in: model.timeZone))", systemImage: "clock")
                .font(.footnote).foregroundStyle(FC.label2)
            Button(busy ? "Reserving…" : "Confirm reservation") {
                busy = true
                Task {
                    await confirm(addToCalendar)
                    busy = false
                }
            }
            .buttonStyle(.fcFilled)
            .disabled(busy)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }
}

private struct WaitlistSheet: View {
    @Environment(AppModel.self) private var model
    let session: ClassSession
    let join: () async -> Void
    @State private var busy = false

    var body: some View {
        let position = session.waitlistCount + 1
        VStack(alignment: .leading, spacing: 16) {
            Text("\(session.title) is full").font(.title2.bold()).padding(.top, 8)
            HStack(spacing: 14) {
                Text("#\(position)").font(FC.metric(28)).foregroundStyle(FC.orange)
                    .frame(width: 72, height: 72)
                    .background(FC.orange.opacity(0.18), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(position == 1 ? "You’d be first in line" : "You’d be #\(position) in line").font(.headline)
                    Text(session.waitlistCount == 0 ? "No one is waiting yet" : "\(session.waitlistCount) ahead of you").font(.footnote).foregroundStyle(FC.label2)
                }
            }
            FCard {
                Label("You’re booked automatically if a spot opens", systemImage: "bolt.fill").font(.subheadline.weight(.semibold))
                Text("A class credit is only used when you get a place. You can leave the waitlist at any time.")
                    .font(.footnote).foregroundStyle(FC.label2)
            }
            Button(busy ? "Joining…" : "Join waitlist") {
                busy = true
                Task {
                    await join()
                    busy = false
                }
            }
            .buttonStyle(.fcFilled)
            .disabled(busy)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }
}

/// Adds a booked class to the athlete's calendar. Uses write-only access: the app never reads it.
enum CalendarExport {
    static func add(_ session: ClassSession) async {
        let store = EKEventStore()
        guard (try? await store.requestWriteOnlyAccessToEvents()) == true else { return }
        let event = EKEvent(eventStore: store)
        event.title = "Fury Co. · \(session.title)"
        event.startDate = session.startsAt
        event.endDate = session.endsAt
        event.calendar = store.defaultCalendarForNewEvents
        try? store.save(event, span: .thisEvent)
    }
}
