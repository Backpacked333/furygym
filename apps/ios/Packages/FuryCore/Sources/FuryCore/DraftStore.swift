import Foundation

/// Where in-progress workout logs are kept between launches.
public protocol DraftStore: Sendable {
    func load(key: String) -> LogDraft?
    func save(_ draft: LogDraft)
    func delete(key: String)
    func all() -> [LogDraft]
}

/// One small JSON file per draft. Drafts untouched for 30 days are cleared on launch.
public final class FileDraftStore: DraftStore, @unchecked Sendable {
    private let directory: URL
    private let lock = NSLock()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func url(for key: String) -> URL {
        // Keys are built from UUIDs, but never let one escape the directory.
        let safe = key.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return directory.appendingPathComponent("\(safe).json")
    }

    public func load(key: String) -> LogDraft? {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? Data(contentsOf: url(for: key)) else { return nil }
        return try? decoder.decode(LogDraft.self, from: data)
    }

    public func save(_ draft: LogDraft) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? encoder.encode(draft) else { return }
        try? data.write(to: url(for: draft.key), options: .atomic)
    }

    public func delete(key: String) {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: url(for: key))
    }

    public func all() -> [LogDraft] {
        lock.lock()
        defer { lock.unlock() }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? Data(contentsOf: $0) }
            .compactMap { try? decoder.decode(LogDraft.self, from: $0) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    /// Removes drafts not touched since `cutoff`. Returns how many were removed.
    @discardableResult
    public func prune(olderThan cutoff: Date) -> Int {
        let stale = all().filter { $0.updatedAt < cutoff }
        stale.forEach { delete(key: $0.key) }
        return stale.count
    }
}

public final class MemoryDraftStore: DraftStore, @unchecked Sendable {
    private var drafts: [String: LogDraft] = [:]
    private let lock = NSLock()

    public init() {}

    public func load(key: String) -> LogDraft? {
        lock.lock()
        defer { lock.unlock() }
        return drafts[key]
    }

    public func save(_ draft: LogDraft) {
        lock.lock()
        defer { lock.unlock() }
        drafts[draft.key] = draft
    }

    public func delete(key: String) {
        lock.lock()
        defer { lock.unlock() }
        drafts[key] = nil
    }

    public func all() -> [LogDraft] {
        lock.lock()
        defer { lock.unlock() }
        return drafts.values.sorted { $0.updatedAt > $1.updatedAt }
    }
}
