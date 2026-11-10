import FuryCore
import SwiftUI

/// Where a calendar entry leads: the workout, and which enrollment (if any) it is logged against.
struct WorkoutRoute: Hashable {
    let workoutID: UUID
    let enrollmentID: UUID?
    let title: String
    let date: DayDate
}

extension CalendarEntry {
    var route: WorkoutRoute { WorkoutRoute(workoutID: workoutId, enrollmentID: enrollmentId, title: title, date: calendarDate) }

    var subtitle: String {
        switch source {
        case .program:
            let place = [week.map { "Week \($0)" }, day.map { "Day \($0)" }].compactMap { $0 }.joined(separator: " · ")
            return [programName, place.isEmpty ? nil : place].compactMap { $0 }.joined(separator: " — ")
        default:
            return trackName ?? "Gym workout"
        }
    }
}

/// One workout on the calendar. Locked program sessions are shown but cannot be opened.
struct EntryRow: View {
    let entry: CalendarEntry

    var body: some View {
        if entry.locked {
            label.opacity(0.55)
        } else {
            NavigationLink(value: entry.route) { label }.buttonStyle(.plain)
        }
    }

    private var label: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2).fill(Color(hex: entry.trackColor)).frame(width: 4, height: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title).font(.headline).lineLimit(2)
                Text(entry.subtitle).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            if entry.locked {
                Image(systemName: "lock.fill").foregroundStyle(Theme.muted).accessibilityLabel("Locked")
            } else if entry.isCompleted {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.good).accessibilityLabel("Logged")
            } else {
                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.muted)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
        .contentShape(Rectangle())
    }
}
