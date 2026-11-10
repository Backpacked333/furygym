import FuryCore
import SwiftUI

/// Home: the next booking with its check-in, today's published workout, and online program progress.
struct TodayView: View {
    private struct Snapshot {
        var entries: [CalendarEntry]
        var nextClass: ClassSession?
        var enrollments: [Enrollment]
        var programCalendar: [CalendarEntry]
    }

    @Environment(AppModel.self) private var model

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: load) { snapshot in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Wordmark(size: 17)
                        Spacer()
                        NavigationLink(value: AccountRoute.profile) {
                            Text(model.initials)
                                .font(.subheadline.weight(.bold))
                                .frame(width: 44, height: 44)
                                .background(FC.bg4, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Profile")
                    }
                    ScreenHeader(eyebrow: DateText.longDay(model.today, in: model.timeZone), title: "Today")

                    attention
                    if let next = snapshot.nextClass { bookingCard(next) }
                    workoutSection(snapshot.entries)
                    ForEach(snapshot.enrollments.filter { $0.status == .active }) { enrollment in
                        programRow(enrollment, calendar: snapshot.programCalendar)
                    }
                    if !model.entitlements.hasFacilityAccess && snapshot.enrollments.isEmpty { getStarted }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .screenBackground()
            .withTabBar()
        }
        .navigationDestination(for: WorkoutRoute.self) { WorkoutDetailView(route: $0) }
        .navigationDestination(for: AccountRoute.self) { $0.destination }
        .navigationDestination(for: ClassSession.self) { ClassDetailView(session: $0) }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func load() async throws -> Snapshot {
        let today = model.today
        async let entries = model.backend.calendar(from: today, to: today)
        async let classes = model.backend.classes(from: Date().addingTimeInterval(-1800), to: Date().addingTimeInterval(7 * 86_400))
        async let enrollments = model.backend.enrollments()
        async let programCalendar = model.backend.calendar(from: today.adding(days: -180), to: today.adding(days: 180))
        let booked = try await classes.first { $0.myBookingStatus == .booked || $0.myBookingStatus == .waitlisted }
        return Snapshot(
            entries: try await entries, nextClass: booked, enrollments: try await enrollments,
            programCalendar: (try? await programCalendar)?.filter { $0.source == .program } ?? []
        )
    }

    /// Things blocking the athlete: an unsigned waiver or a failed payment.
    @ViewBuilder private var attention: some View {
        if let error = model.loadError { FCard { ErrorText(message: error) } }
        if model.needsWaiver {
            NavigationLink(value: AccountRoute.waiver) {
                notice(icon: "signature", title: "Sign your waiver", detail: "Required before you can book a class.")
            }
            .buttonStyle(.plain)
        }
        if model.entitlements.pastDue {
            NavigationLink(value: AccountRoute.billing) {
                notice(icon: "exclamationmark.circle.fill", title: "Payment didn’t go through", detail: "Update your card to keep your membership active.")
            }
            .buttonStyle(.plain)
        }
    }

    private func notice(icon: String, title: String, detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(FC.orange).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.footnote).foregroundStyle(FC.label2)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(FC.label3)
        }
        .padding(16)
        .background(FC.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous).stroke(FC.orange.opacity(0.35), lineWidth: 0.5))
    }

    private func bookingCard(_ session: ClassSession) -> some View {
        let waitlisted = session.myBookingStatus == .waitlisted
        let minutes = Int(session.startsAt.timeIntervalSinceNow / 60)
        let countdown = minutes <= 0 ? "now" : minutes < 60 ? "in \(minutes) min" : minutes < 24 * 60 ? "in \(minutes / 60) hr \(minutes % 60) min" : DateText.relativeDay(DayDate(session.startsAt, in: model.timeZone), today: model.today, in: model.timeZone)
        return FCard {
            HStack {
                if waitlisted {
                    Chip(text: session.myWaitlistPosition.map { "Waitlist #\($0)" } ?? "Waitlist", color: FC.orange)
                } else {
                    Chip(text: "Booked", color: FC.green, systemImage: "checkmark.circle.fill")
                }
                Spacer()
                Text(countdown).font(.footnote).foregroundStyle(FC.label2)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("\(session.title) · \(DateText.time(session.startsAt, in: model.timeZone))").font(.title2.bold())
                Text([session.coachName.map { "Coach \($0)" }, "\(session.bookedCount)/\(session.capacity)"].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(FC.label2)
            }
            HStack(spacing: 10) {
                if !waitlisted {
                    Button { model.tab = .checkIn } label: { Label("Check in", systemImage: "qrcode") }
                        .buttonStyle(.fc(.filled, size: .medium, fullWidth: false))
                }
                NavigationLink(value: session) { Text("Details").frame(maxWidth: .infinity) }
                    .buttonStyle(.fc(.gray, size: .medium))
            }
        }
    }

    @ViewBuilder private func workoutSection(_ entries: [CalendarEntry]) -> some View {
        let gym = entries.filter { $0.source == .facility }
        ForEach(gym) { entry in
            NavigationLink(value: entry.route) {
                VStack(alignment: .leading, spacing: 0) {
                    ZStack(alignment: .topLeading) {
                        HeroBackdrop(tint: Color(hex: entry.trackColor)).frame(height: 120)
                        TrackChip(name: entry.trackName, hex: entry.trackColor).padding(14)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(entry.title).font(.headline)
                            Spacer()
                            if entry.isCompleted { Image(systemName: "checkmark.circle.fill").foregroundStyle(FC.green).accessibilityLabel("Logged") }
                        }
                        Text(entry.isCompleted ? "View your log" : "Open workout")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(FC.redHi)
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(FC.red.opacity(0.16), in: Capsule())
                    }
                    .padding(16)
                }
                .background(FC.bg2)
                .clipShape(RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        if gym.isEmpty && model.entitlements.hasFacilityAccess {
            FCard {
                Text("Nothing programmed for today.").font(.headline)
                Text("Check Train for the rest of the week.").font(.footnote).foregroundStyle(FC.label2)
            }
        }
    }

    private func programRow(_ enrollment: Enrollment, calendar: [CalendarEntry]) -> some View {
        let mine = calendar.filter { $0.enrollmentId == enrollment.id }
        let done = mine.filter(\.isCompleted).count
        let weeks = enrollment.programs?.durationWeeks ?? 0
        let phase = ProgramSchedule.phase(start: enrollment.startDate, expiresAt: enrollment.expiresAt, durationWeeks: weeks, today: model.today)
        let todays = mine.first { $0.calendarDate == model.today }
        let ringLabel: String
        let detail: String
        switch phase {
        case .upcoming(let days):
            ringLabel = "—"
            detail = days == 1 ? "Starts tomorrow" : "Starts in \(days) days"
        case .inProgress(let week, _):
            ringLabel = "W\(week)"
            detail = todays.map { "Today: \($0.title)" } ?? "Rest day"
        case .finished(let left):
            ringLabel = "✓"
            detail = "Complete · \(left) days of access left"
        case .expired:
            ringLabel = "—"
            detail = "Access has ended"
        }
        return NavigationLink(value: AccountRoute.program(enrollment.id)) {
            HStack(spacing: 14) {
                Ring(progress: mine.isEmpty ? 0 : Double(done) / Double(mine.count), size: 56, lineWidth: 6, color: FC.indigo) {
                    Text(ringLabel).font(.footnote.weight(.bold))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Eyebrow(text: "Online program", color: FC.indigo)
                    Text(enrollment.programs?.name ?? "Program").font(.headline)
                    Text(detail).font(.footnote).foregroundStyle(FC.label2).lineLimit(1)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(FC.label3)
            }
            .padding(16)
            .background(FC.bg2, in: RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var getStarted: some View {
        FCard {
            Text("Get started").font(.headline)
            Text("Join the gym to book classes and follow the daily programming, or train anywhere with an online program.")
                .font(.footnote).foregroundStyle(FC.label2)
            HStack(spacing: 10) {
                Button("Join the gym") { model.flow = .joinGym }.buttonStyle(.fc(.filled, size: .medium, fullWidth: false))
                Button("Online programs") { model.flow = .programs }.buttonStyle(.fc(.gray, size: .medium, fullWidth: false))
            }
        }
    }
}
