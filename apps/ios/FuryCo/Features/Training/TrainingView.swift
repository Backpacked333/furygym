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

    /// "STRENGTH" or "SELECTION · W3·D2"
    var eyebrow: String {
        let track = (trackName ?? (source == .program ? "Program" : "Workout")).uppercased()
        if source == .program, let week, let day { return "\(track) · W\(week)·D\(day)" }
        return track
    }
}

/// One workout on the calendar. Locked program sessions are shown but cannot be opened.
struct EntryRow: View {
    let entry: CalendarEntry
    var highlighted = false
    var unlockLabel: String?

    var body: some View {
        if entry.locked {
            label.opacity(0.55)
        } else {
            NavigationLink(value: entry.route) { label }.buttonStyle(.plain)
        }
    }

    private var label: some View {
        let color = Color(hex: entry.trackColor)
        return HStack(spacing: 12) {
            Capsule().fill(color).frame(width: 3, height: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.eyebrow).font(.caption2.weight(.bold)).foregroundStyle(color)
                Text(entry.locked ? (unlockLabel ?? entry.title) : entry.title).font(.headline).lineLimit(1)
            }
            Spacer(minLength: 8)
            if entry.locked {
                Image(systemName: "lock.fill").foregroundStyle(FC.label3).accessibilityLabel("Locked")
            } else if entry.isCompleted {
                Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(FC.green).accessibilityLabel("Logged")
            } else {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(FC.label3)
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 58)
        .background(FC.bg2, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(highlighted ? FC.red.opacity(0.8) : .clear, lineWidth: 1.5))
        .contentShape(Rectangle())
    }
}

/// One calendar for everything: gym workouts and online program days, by week, month or as a list.
struct TrainingView: View {
    @Environment(AppModel.self) private var model
    @State private var mode = 0
    @State private var weekStart: DayDate?
    @State private var monthOffset = 0
    @State private var selectedDay: DayDate?

    private var start: DayDate { weekStart ?? model.today.startOfWeek }
    private var monthFirst: DayDate {
        var year = model.today.year, month = model.today.month + monthOffset
        while month > 12 { month -= 12; year += 1 }
        while month < 1 { month += 12; year -= 1 }
        return DayDate(year: year, month: month, day: 1)
    }
    private var range: (DayDate, DayDate) {
        switch mode {
        case 1:
            let first = monthFirst.startOfWeek
            return (first, first.adding(days: 41))
        case 2: return (model.today, model.today.adding(days: 27))
        default: return (start, start.adding(days: 6))
        }
    }

    var body: some View {
        let (from, to) = range
        AsyncContent(reloadKey: model.revision &* 100_000 &+ from.dayNumber &* 3 &+ mode, load: { try await model.backend.calendar(from: from, to: to) }) { entries in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: headerEyebrow, title: "Train") {
                        if mode != 2 {
                            HStack(spacing: 8) {
                                GlassIconButton(systemName: "chevron.left", label: "Earlier") { step(-1) }
                                GlassIconButton(systemName: "chevron.right", label: "Later") { step(1) }
                            }
                        }
                    }
                    .padding(.top, 8)
                    PillSegmented(options: ["Week", "Month", "List"], selection: $mode)

                    let byDay = Dictionary(grouping: entries, by: \.calendarDate)
                    switch mode {
                    case 1: monthGrid(byDay)
                    case 2: dayList(days: byDay.keys.sorted(), byDay: byDay)
                    default: dayList(days: (0..<7).map { start.adding(days: $0) }, byDay: byDay)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .screenBackground()
            .withTabBar()
        }
        .navigationDestination(for: WorkoutRoute.self) { WorkoutDetailView(route: $0) }
        .navigationDestination(for: AccountRoute.self) { $0.destination }
        .toolbar(.hidden, for: .navigationBar)
    }

    private var headerEyebrow: String {
        switch mode {
        case 1: return DateText.monthYear(monthFirst, in: model.timeZone)
        case 2: return "Next 4 weeks"
        default: return start == model.today.startOfWeek ? "This week" : "Week of \(DateText.shortDay(start, in: model.timeZone))"
        }
    }

    private func step(_ by: Int) {
        if mode == 1 {
            monthOffset += by
            selectedDay = nil
        } else {
            weekStart = start.adding(days: 7 * by)
        }
    }

    private func sorted(_ entries: [CalendarEntry]) -> [CalendarEntry] {
        CalendarGrouping.byDay(entries).flatMap(\.entries)
    }

    private func unlockLabel(_ entry: CalendarEntry) -> String? {
        // Weekly unlock is the default rule; the server stays the authority on what is open.
        guard entry.locked, let week = entry.week, let day = entry.day else { return nil }
        let weekStart = entry.calendarDate.adding(days: -(day - 1))
        return weekStart > model.today ? "Week \(week) opens \(DateText.shortDay(weekStart, in: model.timeZone))" : "Locked"
    }

    @ViewBuilder private func dayList(days: [DayDate], byDay: [DayDate: [CalendarEntry]]) -> some View {
        if days.isEmpty {
            FCard { Text("Nothing on your calendar yet.").foregroundStyle(FC.label2) }
        }
        ForEach(days, id: \.self) { day in
            let isToday = day == model.today
            HStack(alignment: .top, spacing: 12) {
                VStack(spacing: 0) {
                    Text(DateText.weekdayShort(day, in: model.timeZone).uppercased()).font(.caption2.weight(.bold)).foregroundStyle(isToday ? FC.red : FC.label2)
                    Text("\(day.day)").font(.title3.weight(.bold)).foregroundStyle(isToday ? FC.red : .white)
                }
                .frame(width: 40)
                .padding(.top, 8)
                VStack(spacing: 8) {
                    let list = sorted(byDay[day] ?? [])
                    if list.isEmpty {
                        Text("Rest").font(.subheadline).foregroundStyle(FC.label3).frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
                    } else {
                        ForEach(list) { EntryRow(entry: $0, highlighted: isToday && !$0.isCompleted && !$0.locked, unlockLabel: unlockLabel($0)) }
                    }
                }
            }
        }
    }

    private func monthGrid(_ byDay: [DayDate: [CalendarEntry]]) -> some View {
        let first = monthFirst.startOfWeek
        let shown = selectedDay ?? (monthFirst.month == model.today.month && monthFirst.year == model.today.year ? model.today : monthFirst)
        return VStack(alignment: .leading, spacing: 14) {
            FCard(padding: 12, spacing: 6) {
                HStack(spacing: 0) {
                    ForEach(["M", "T", "W", "T", "F", "S", "S"].indices, id: \.self) { index in
                        Text(["M", "T", "W", "T", "F", "S", "S"][index]).font(.caption2.weight(.bold)).foregroundStyle(FC.label2).frame(maxWidth: .infinity)
                    }
                }
                ForEach(0..<6, id: \.self) { week in
                    HStack(spacing: 0) {
                        ForEach(0..<7, id: \.self) { column in
                            let day = first.adding(days: week * 7 + column)
                            let inMonth = day.month == monthFirst.month
                            let entries = byDay[day] ?? []
                            Button { selectedDay = day } label: {
                                VStack(spacing: 3) {
                                    Text("\(day.day)")
                                        .font(.subheadline.weight(day == model.today ? .bold : .regular))
                                        .foregroundStyle(day == shown ? .white : day == model.today ? FC.red : inMonth ? .white : FC.label3)
                                        .frame(width: 34, height: 34)
                                        .background(day == shown ? FC.redFill : .clear, in: Circle())
                                    HStack(spacing: 2) {
                                        ForEach(entries.prefix(3)) { entry in
                                            Circle().fill(entry.isCompleted ? FC.green : Color(hex: entry.trackColor)).frame(width: 4, height: 4)
                                        }
                                    }
                                    .frame(height: 4)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(DateText.longDay(day, in: model.timeZone)), \(entries.count) sessions")
                        }
                    }
                }
            }
            Text(DateText.longDay(shown, in: model.timeZone)).font(.headline).padding(.horizontal, 4)
            let list = sorted(byDay[shown] ?? [])
            if list.isEmpty {
                Text("Rest day").font(.subheadline).foregroundStyle(FC.label2).padding(.horizontal, 4)
            } else {
                ForEach(list) { EntryRow(entry: $0, highlighted: shown == model.today && !$0.isCompleted && !$0.locked, unlockLabel: unlockLabel($0)) }
            }
        }
    }
}
