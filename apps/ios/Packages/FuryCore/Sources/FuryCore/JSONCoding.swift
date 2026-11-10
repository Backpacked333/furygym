import Foundation

/// JSON settings for talking to the Fury Co. backend (PostgREST): snake_case keys and Postgres
/// timestamps. The app hands these to the Supabase client so every response decodes the same way.
public enum JSONCoding {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            guard let date = Timestamp.parse(raw) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not a timestamp: \(raw)")
            }
            return date
        }
        return decoder
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(Timestamp.format(date))
        }
        return encoder
    }
}

/// Parses the timestamp shapes Postgres and PostgREST produce:
/// `2026-11-10T08:15:51.123456+00:00`, `2026-11-10T08:15:51Z`, `2026-11-10 08:15:51+00`.
public enum Timestamp {
    public static func parse(_ raw: String) -> Date? {
        var text = raw.trimmingCharacters(in: .whitespaces)
        guard text.count >= 19 else { return nil }
        // Normalise the separator between date and time.
        let separatorIndex = text.index(text.startIndex, offsetBy: 10)
        if text[separatorIndex] == " " { text.replaceSubrange(separatorIndex...separatorIndex, with: "T") }

        let dateTime = String(text.prefix(19))
        var rest = Substring(text.dropFirst(19))

        var fraction = 0.0
        if rest.first == "." {
            let digits = rest.dropFirst().prefix { $0.isNumber }
            fraction = Double("0." + digits) ?? 0
            rest = rest.dropFirst(1 + digits.count)
        }

        guard let offset = offsetSeconds(String(rest)) else { return nil }
        let pieces = dateTime.split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).compactMap { Int($0) }
        guard pieces.count == 6, let day = DayDate(String(dateTime.prefix(10))),
              (0...23).contains(pieces[3]), (0...59).contains(pieces[4]), (0...60).contains(pieces[5])
        else { return nil }

        let seconds = day.dayNumber * 86_400 + pieces[3] * 3600 + pieces[4] * 60 + pieces[5] - offset
        return Date(timeIntervalSince1970: Double(seconds) + fraction)
    }

    /// "Z", "", "+00", "+00:00", "-0530" → seconds east of UTC.
    private static func offsetSeconds(_ raw: String) -> Int? {
        if raw.isEmpty || raw == "Z" || raw == "z" { return 0 }
        guard let sign = raw.first, sign == "+" || sign == "-" else { return nil }
        let digits = raw.dropFirst().filter { $0 != ":" }
        guard digits.allSatisfy({ $0.isNumber }), digits.count == 2 || digits.count == 4 else { return nil }
        let hours = Int(digits.prefix(2)) ?? 0
        let minutes = digits.count == 4 ? (Int(digits.suffix(2)) ?? 0) : 0
        return (sign == "-" ? -1 : 1) * (hours * 3600 + minutes * 60)
    }

    public static func format(_ date: Date) -> String {
        let total = Int(date.timeIntervalSince1970.rounded(.down))
        let dayNumber = Int((Double(total) / 86_400).rounded(.down))
        let secondsOfDay = total - dayNumber * 86_400
        let two = { (n: Int) in n < 10 ? "0\(n)" : "\(n)" }
        return "\(DayDate(dayNumber: dayNumber))T\(two(secondsOfDay / 3600)):\(two(secondsOfDay % 3600 / 60)):\(two(secondsOfDay % 60))Z"
    }
}
