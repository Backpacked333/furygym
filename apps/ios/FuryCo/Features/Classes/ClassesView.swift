import FuryCore
import SwiftUI

/// The class schedule for the booking window, with book, waitlist and cancel on each row.
struct ClassesView: View {
    @Environment(AppModel.self) private var model
    @State private var selectedDay: DayDate?
    @State private var working: UUID?
    @State private var error: String?
    @State private var confirmLateCancel: ClassSession?

    private var day: DayDate { selectedDay ?? model.today }
    private var window: Int { min(max(model.gym?.bookingWindowDays ?? 14, 1), 28) }

    var body: some View {
        NavigationStack {
            AsyncContent(reloadKey: model.revision, load: load) { sessions in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(model.entitlements.headline).font(.footnote).foregroundStyle(Theme.muted)
                        dayStrip(sessions)
                        ErrorText(message: error)

                        let todays = sessions.filter { DayDate($0.startsAt, in: model.timeZone) == day }
                        if todays.isEmpty {
                            Card { Text("No classes on \(DateText.day(day, in: model.timeZone)).").font(.subheadline).foregroundStyle(Theme.muted) }
                        } else {
                            ForEach(todays) { row($0) }
                        }
                    }
                    .padding(16)
                }
                .screenBackground()
            }
            .navigationTitle("Classes")
            .navigationDestination(for: AccountRoute.self) { $0.destination }
            .confirmationDialog(
                "Cancel this late?",
                isPresented: Binding(get: { confirmLateCancel != nil }, set: { if !$0 { confirmLateCancel = nil } }),
                titleVisibility: .visible,
                presenting: confirmLateCancel
            ) { session in
                Button("Cancel my booking", role: .destructive) { Task { await cancel(session) } }
                Button("Keep my place", role: .cancel) {}
            } message: { _ in
                Text("Free cancellation closed \(model.gym?.cancelCutoffMinutes ?? 60) minutes before class. If you booked with a class credit, it will not be returned.")
            }
        }
    }

    private func load() async throws -> [ClassSession] {
        let start = model.today.noon(in: model.timeZone).addingTimeInterval(-12 * 3600)
        return try await model.backend.classes(from: start, to: start.addingTimeInterval(Double(window + 1) * 86_400))
    }

    private func dayStrip(_ sessions: [ClassSession]) -> some View {
        let booked = Set(sessions.filter { $0.myBookingStatus == .booked || $0.myBookingStatus == .waitlisted }.map { DayDate($0.startsAt, in: model.timeZone) })
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(0...window, id: \.self) { offset in
                    let date = model.today.adding(days: offset)
                    Button { selectedDay = date } label: {
                        VStack(spacing: 4) {
                            Text(DateText.weekdayInitial(date, in: model.timeZone)).font(.caption2).foregroundStyle(Theme.muted)
                            Text("\(date.day)").font(.headline)
                            Circle().fill(booked.contains(date) ? Theme.good : .clear).frame(width: 5, height: 5)
                        }
                        .frame(width: 44, height: 62)
                        .background(date == day ? Theme.accent.opacity(0.25) : Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(date == day ? Theme.accent : Theme.line))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(DateText.longDay(date, in: model.timeZone) + (booked.contains(date) ? ", booked" : ""))
                }
            }
        }
    }

    private func row(_ session: ClassSession) -> some View {
        let action = ClassBooking.action(for: session, now: Date(), cancelCutoffMinutes: model.gym?.cancelCutoffMinutes ?? 60, bookingWindowDays: model.gym?.bookingWindowDays ?? 14)
        return Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        TrackDot(hex: session.trackColor)
                        Text(session.title).font(.headline)
                    }
                    Text("\(DateText.time(session.startsAt, in: model.timeZone)) – \(DateText.time(session.endsAt, in: model.timeZone))")
                        .font(.subheadline.monospacedDigit())
                    Text([session.coachName, ClassBooking.spotsLabel(for: session)].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer()
                status(session)
            }
            actionButton(action, session: session)
        }
    }

    @ViewBuilder private func status(_ session: ClassSession) -> some View {
        switch session.myBookingStatus {
        case .booked: Pill(text: "Booked", color: Theme.good)
        case .waitlisted: Pill(text: session.myWaitlistPosition.map { "Waitlist #\($0)" } ?? "Waitlist", color: Theme.warn)
        case .attended: Pill(text: "Attended", color: Theme.good)
        default: EmptyView()
        }
    }

    @ViewBuilder private func actionButton(_ action: BookingAction, session: ClassSession) -> some View {
        let busy = working == session.id
        switch action {
        case .book, .joinWaitlist:
            if model.needsWaiver {
                NavigationLink("Sign waiver to book", value: AccountRoute.waiver).buttonStyle(SecondaryButtonStyle())
            } else if !model.entitlements.canBookClasses {
                NavigationLink("Get a membership to book", value: AccountRoute.membership).buttonStyle(SecondaryButtonStyle())
            } else {
                Button(busy ? "Booking…" : action.title) { Task { await book(session) } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
            }
        case .cancel(let late):
            Button(busy ? "Cancelling…" : action.title) {
                if late { confirmLateCancel = session } else { Task { await cancel(session) } }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(busy)
        case .leaveWaitlist:
            Button(busy ? "Leaving…" : action.title) { Task { await cancel(session) } }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy)
        case .unavailable(let reason):
            if session.myBookingStatus == nil || session.myBookingStatus == .cancelled {
                Text(reason).font(.footnote).foregroundStyle(Theme.muted)
            }
        }
    }

    private func book(_ session: ClassSession) async {
        working = session.id
        error = nil
        defer { working = nil }
        do {
            let status = try await model.backend.book(sessionID: session.id)
            if status == .booked { await Reminders.schedule(for: session, timeZone: model.timeZone) }
            await model.refreshAccount() // class credits may have changed
            model.didChange()
        } catch {
            self.error = Backend.message(for: error)
        }
    }

    private func cancel(_ session: ClassSession) async {
        guard let bookingID = session.myBookingId else { return }
        working = session.id
        error = nil
        defer { working = nil }
        do {
            try await model.backend.cancelBooking(id: bookingID)
            Reminders.cancel(for: session.id)
            await model.refreshAccount()
            model.didChange()
        } catch {
            self.error = Backend.message(for: error)
        }
    }
}
