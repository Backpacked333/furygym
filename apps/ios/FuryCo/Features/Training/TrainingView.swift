import FuryCore
import SwiftUI

/// The athlete's training calendar: gym workouts and program days together, a week at a time.
struct TrainingView: View {
    @Environment(AppModel.self) private var model
    @State private var weekStart: DayDate?

    private var start: DayDate { weekStart ?? model.today.startOfWeek }

    var body: some View {
        NavigationStack {
            AsyncContent(reloadKey: model.revision &* 1000 &+ start.dayNumber, load: { try await model.backend.calendar(from: start, to: start.adding(days: 6)) }) { entries in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        weekPicker
                        let grouped = Dictionary(grouping: entries, by: \.calendarDate)
                        ForEach(0..<7, id: \.self) { offset in
                            let day = start.adding(days: offset)
                            daySection(day, entries: CalendarGrouping.byDay(grouped[day] ?? []).flatMap(\.entries))
                        }
                        adherence(entries)
                    }
                    .padding(16)
                }
                .screenBackground()
            }
            .navigationTitle("Training")
            .navigationDestination(for: WorkoutRoute.self) { WorkoutDetailView(route: $0) }
        }
    }

    private var weekPicker: some View {
        HStack {
            Button { weekStart = start.adding(days: -7) } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Previous week")
            Spacer()
            VStack(spacing: 2) {
                Text("Week of \(DateText.day(start, in: model.timeZone))").font(.subheadline.weight(.semibold))
                if start != model.today.startOfWeek {
                    Button("Back to this week") { weekStart = nil }.font(.caption)
                }
            }
            Spacer()
            Button { weekStart = start.adding(days: 7) } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Next week")
        }
        .padding(.horizontal, 4)
    }

    private func daySection(_ day: DayDate, entries: [CalendarEntry]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(DateText.relativeDay(day, today: model.today, in: model.timeZone))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(day == model.today ? Theme.accent : .primary)
                if day == model.today { Circle().fill(Theme.accent).frame(width: 6, height: 6) }
            }
            if entries.isEmpty {
                Text("Rest").font(.footnote).foregroundStyle(Theme.muted).padding(.leading, 2)
            } else {
                ForEach(entries) { EntryRow(entry: $0) }
            }
        }
    }

    @ViewBuilder private func adherence(_ entries: [CalendarEntry]) -> some View {
        let result = Adherence.through(model.today, entries: entries.filter { !$0.locked })
        if result.scheduled > 0 {
            Card {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("This week so far").font(.caption).foregroundStyle(Theme.muted)
                        Text("\(result.completed) of \(result.scheduled) sessions logged").font(.subheadline.weight(.semibold))
                    }
                    Spacer()
                    Text("\(result.percent)%").font(.title2.bold()).foregroundStyle(result.percent >= 80 ? Theme.good : .primary)
                }
            }
        }
    }
}
