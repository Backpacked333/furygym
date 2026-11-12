import Foundation

public enum LoadUnit: String, Codable, CaseIterable, Sendable {
    case lb, kg

    public static let poundsPerKilogram = 2.204_622_621_8

    public func fromKilograms(_ kg: Double) -> Double {
        self == .kg ? kg : kg * LoadUnit.poundsPerKilogram
    }
}

public enum DistanceUnit: String, Codable, CaseIterable, Sendable {
    case m, km, mi

    public var meters: Double {
        switch self {
        case .m: return 1
        case .km: return 1000
        case .mi: return 1609.344
        }
    }
}

public enum Format {
    /// 754 → "12:34", 3723 → "1:02:03", 62.5 → "1:02.5"
    public static func duration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "—" }
        let tenths = Int((seconds * 10).rounded())
        let whole = tenths / 10
        let h = whole / 3600, m = whole % 3600 / 60, s = whole % 60
        let two = { (n: Int) in n < 10 ? "0\(n)" : "\(n)" }
        let base = h > 0 ? "\(h):\(two(m)):\(two(s))" : "\(m):\(two(s))"
        return tenths % 10 == 0 ? base : "\(base).\(tenths % 10)"
    }

    /// Whole numbers without a decimal point, otherwise up to two places: 235, 102.5, 61.25
    public static func number(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        if rounded == rounded.rounded() { return String(Int(rounded)) }
        var text = String(format: "%.2f", rounded)
        while text.hasSuffix("0") { text.removeLast() }
        return text
    }

    public static func load(_ value: Double, unit: String) -> String {
        "\(number(value)) \(unit)"
    }

    /// 4800 → "4.8 km", 400 → "400 m"
    public static func distance(meters: Double) -> String {
        meters >= 1000 ? "\(number(meters / 1000)) km" : "\(number(meters)) m"
    }

    public static func money(cents: Int, currency: String = "usd") -> String {
        let sign = cents < 0 ? "-" : ""
        let value = abs(cents)
        let symbol = currency.lowercased() == "usd" ? "$" : "\(currency.uppercased()) "
        let whole = String(value / 100)
        var grouped = ""
        for (index, character) in whole.reversed().enumerated() {
            if index > 0 && index % 3 == 0 { grouped.append(",") }
            grouped.append(character)
        }
        let centsPart = value % 100
        return "\(sign)\(symbol)\(String(grouped.reversed())).\(centsPart < 10 ? "0" : "")\(centsPart)"
    }

    /// One line describing what was recorded for a set: "235 lb · 5 reps · RPE 8"
    public static func summary(of entry: LogEntry) -> String {
        var parts: [String] = []
        if let load = entry.load { parts.append(Format.load(load, unit: entry.loadUnit)) }
        if let sets = entry.sets { parts.append("\(sets) sets") }
        if let reps = entry.reps { parts.append("\(reps) reps") }
        if let time = entry.timeSeconds { parts.append(duration(time)) }
        if let distance = entry.distanceM { parts.append(Format.distance(meters: distance)) }
        if let pace = entry.paceSeconds { parts.append("\(duration(pace)) / \(entry.paceUnit ?? "km")") }
        if let splits = entry.splits, !splits.isEmpty { parts.append("splits " + splits.map(duration).joined(separator: ", ")) }
        if let rpe = entry.rpe { parts.append("RPE \(number(rpe))") }
        return parts.joined(separator: " · ")
    }
}

public enum Parse {
    /// "12:34" → 754, "1:02:03" → 3723, "45" → 45 (seconds), "1:02.5" → 62.5. Nil if not a time.
    public static func duration(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let parts = trimmed.split(separator: ":", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count) else { return nil }
        var total = 0.0
        for (index, part) in parts.enumerated() {
            let isLast = index == parts.count - 1
            guard let value = isLast ? decimal(String(part)) : Int(part).map(Double.init), value >= 0 else { return nil }
            // Minutes and seconds must be below 60 once there is a larger unit in front of them.
            if index > 0 && value >= 60 { return nil }
            total = total * 60 + value
        }
        return total
    }

    /// Accepts "102.5" and "102,5"; rejects anything that is not a plain non-negative number.
    public static func decimal(_ text: String) -> Double? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !cleaned.isEmpty, cleaned.allSatisfy({ $0.isNumber || $0 == "." }), cleaned.filter({ $0 == "." }).count <= 1,
              let value = Double(cleaned), value.isFinite
        else { return nil }
        return value
    }

    public static func integer(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.allSatisfy({ $0.isNumber }) else { return nil }
        return Int(trimmed)
    }
}
