import Foundation
import FuryCore
import UserNotifications

/// Local reminders an hour before a booked class. These are scheduled on the device, so they work
/// without a push-notification server; server-sent pushes are a later addition.
enum Reminders {
    private static func identifier(_ sessionID: UUID) -> String { "class-\(sessionID.uuidString)" }

    static func schedule(for session: ClassSession, timeZone: TimeZone) async {
        let center = UNUserNotificationCenter.current()
        guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return }

        let fireDate = session.startsAt.addingTimeInterval(-3600)
        guard fireDate > Date() else { return }

        let content = UNMutableNotificationContent()
        content.title = session.title
        content.body = "Starts at \(DateText.time(session.startsAt, in: timeZone)). See you there."
        content.sound = .default

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
        components.timeZone = timeZone
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        try? await center.add(UNNotificationRequest(identifier: identifier(session.id), content: content, trigger: trigger))
    }

    static func cancel(for sessionID: UUID) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier(sessionID)])
    }
}
