import FuryCore
import SwiftUI

/// The home screen: today's training, the next class, and anything that needs attention.
struct TodayView: View {
    private struct Snapshot {
        var entries: [CalendarEntry]
        var nextClass: ClassSession?
        var enrollments: [Enrollment]
    }

    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            AsyncContent(reloadKey: model.revision, load: load) { snapshot in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header
                        attention
                        todaySection(snapshot.entries)
                        if let next = snapshot.nextClass { nextClassCard(next) }
                        ForEach(snapshot.enrollments.filter { $0.status == .active }) { programCard($0) }
                    }
                    .padding(16)
                }
                .screenBackground()
            }
            .navigationDestination(for: WorkoutRoute.self) { WorkoutDetailView(route: $0) }
            .navigationDestination(for: AccountRoute.self) { $0.destination }
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private func load() async throws -> Snapshot {
        let today = model.today
        async let entries = model.backend.calendar(from: today, to: today)
        async let classes = model.backend.classes(from: Date(), to: Date().addingTimeInterval(7 * 86_400))
        async let enrollments = model.backend.enrollments()
        let booked = try await classes.first { $0.myBookingStatus == .booked || $0.myBookingStatus == .waitlisted }
        return Snapshot(entries: try await entries, nextClass: booked, enrollments: try await enrollments)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(DateText.longDay(model.today, in: model.timeZone).uppercased())
                .font(.caption.weight(.semibold)).tracking(1).foregroundStyle(Theme.accent)
            Text(greeting).font(.largeTitle.bold())
        }
        .padding(.top, 8)
    }

    private var greeting: String {
        let first = model.profile?.fullName.split(separator: " ").first.map(String.init)
        return first.map { "Let's work, \($0)." } ?? "Let's work."
    }

    /// Things blocking the athlete: an unsigned waiver, no membership, a failed payment.
    @ViewBuilder private var attention: some View {
        if let error = model.loadError {
            Card { ErrorText(message: error) }
        }
        if model.needsWaiver {
            NavigationLink(value: AccountRoute.waiver) {
                notice(icon: "signature", title: "Sign your waiver", detail: "Required before you can book a class.")
            }
            .buttonStyle(.plain)
        }
        if model.entitlements.pastDue {
            NavigationLink(value: AccountRoute.membership) {
                notice(icon: "creditcard.trianglebadge.exclamationmark", title: "Payment problem", detail: "Update your card to keep your membership active.")
            }
            .buttonStyle(.plain)
        }
    }

    private func notice(icon: String, title: String, detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(Theme.warn).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.muted)
        }
        .padding(14)
        .background(Theme.warn.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.warn.opacity(0.4)))
    }

    @ViewBuilder private func todaySection(_ entries: [CalendarEntry]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Today's training")
            if entries.isEmpty {
                Card {
                    Text(model.entitlements.hasFacilityAccess ? "Nothing programmed for today." : "No training on your calendar today.")
                        .font(.subheadline)
                    if !model.entitlements.hasFacilityAccess {
                        Text("Gym workouts appear here with a membership. Online programs appear once you enrol.")
                            .font(.caption).foregroundStyle(Theme.muted)
                        NavigationLink("See memberships", value: AccountRoute.membership).font(.subheadline.weight(.semibold))
                    }
                }
            } else {
                ForEach(CalendarGrouping.byDay(entries).flatMap(\.entries)) { EntryRow(entry: $0) }
            }
        }
    }

    private func nextClassCard(_ session: ClassSession) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: session.myBookingStatus == .waitlisted ? "On the waitlist" : "Your next class")
            Card {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(session.title).font(.headline)
                        Text("\(DateText.relativeDay(DayDate(session.startsAt, in: model.timeZone), today: model.today, in: model.timeZone)) at \(DateText.time(session.startsAt, in: model.timeZone))")
                            .font(.subheadline).foregroundStyle(Theme.muted)
                        if let coach = session.coachName { Text("with \(coach)").font(.caption).foregroundStyle(Theme.muted) }
                    }
                    Spacer()
                    if session.myBookingStatus == .waitlisted, let position = session.myWaitlistPosition {
                        Pill(text: "Waitlist #\(position)", color: Theme.warn)
                    } else {
                        Pill(text: "Booked", color: Theme.good)
                    }
                }
            }
        }
    }

    private func programCard(_ enrollment: Enrollment) -> some View {
        let weeks = enrollment.programs?.durationWeeks ?? 0
        let phase = ProgramSchedule.phase(start: enrollment.startDate, expiresAt: enrollment.expiresAt, durationWeeks: weeks, today: model.today)
        return VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Your program")
            Card {
                Text(enrollment.programs?.name ?? "Program").font(.headline)
                switch phase {
                case .upcoming(let days):
                    Text(days == 1 ? "Starts tomorrow" : "Starts in \(days) days").font(.subheadline).foregroundStyle(Theme.muted)
                case .inProgress(let week, let total):
                    Text("Week \(week) of \(total)").font(.subheadline).foregroundStyle(Theme.muted)
                    ProgressView(value: Double(week), total: Double(max(total, 1))).tint(Theme.accent)
                case .finished(let left):
                    Text("Program complete · \(left) days of access left").font(.subheadline).foregroundStyle(Theme.muted)
                case .expired:
                    Text("Access has ended").font(.subheadline).foregroundStyle(Theme.muted)
                }
            }
        }
    }
}
