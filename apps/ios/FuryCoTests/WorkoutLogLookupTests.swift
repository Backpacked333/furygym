import FuryCore
import Supabase
import XCTest
@testable import FuryCo

final class WorkoutLogLookupTests: XCTestCase {
    private func backend(signedIn: Bool = true) async throws -> Backend {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [LogLookupProtocol.self]
        let config = AppConfig(supabaseURL: URL(string: "https://workout-tests.invalid")!, supabaseAnonKey: "fixture", webBaseURL: URL(string: "https://workout-tests.invalid")!)
        let backend = Backend(config: config, options: .init(
            auth: .init(storage: TestAuthStorage(), autoRefreshToken: false, emitLocalSessionAsInitialSession: true),
            global: .init(session: URLSession(configuration: sessionConfig))
        ))
        if signedIn { try await backend.signIn(email: "athlete@example.invalid", password: "fixture") }
        return backend
    }

    func testFacilityLogUsesExactIdentityAndPreservesOldData() async throws {
        let backend = try await backend()
        let result = try await backend.log(workoutID: LogLookupProtocol.workoutID, enrollmentID: nil)
        let log = try XCTUnwrap(result)
        XCTAssertEqual(log.performedOn, DayDate("2000-01-01"))
        XCTAssertEqual(log.notes, "Keep this old note")
        XCTAssertEqual(log.rpe, 7.5)
        XCTAssertEqual(log.entries.count, 2)
        var draft = LogForm.draft(from: log, ownerID: LogLookupProtocol.userID, workout: LogLookupProtocol.workout, loadUnit: .lb)
        draft.items[LogLookupProtocol.itemID]![0].load = "201.5"
        let submission = try LogForm.submission(from: draft, workout: LogLookupProtocol.workout).get()
        XCTAssertEqual(submission.notes, log.notes)
        XCTAssertEqual(submission.rpe, 7.5)
        XCTAssertEqual(submission.entries.map(\.load), [201.5, 190.5])
        XCTAssertEqual(submission.entries.map(\.reps), [5, 6])
    }

    func testProgramLogFiltersTheExactEnrollment() async throws {
        let backend = try await backend()
        let log = try await backend.log(workoutID: LogLookupProtocol.workoutID, enrollmentID: LogLookupProtocol.enrollmentID)
        XCTAssertEqual(log?.enrollmentId, LogLookupProtocol.enrollmentID)
    }

    func testMissingLogReturnsNil() async throws {
        let backend = try await backend()
        let log = try await backend.log(workoutID: LogLookupProtocol.missingID, enrollmentID: nil)
        XCTAssertNil(log)
    }

    func testLookupFailureDoesNotBecomeANewBlankLog() async throws {
        let backend = try await backend()
        do {
            _ = try await backend.log(workoutID: LogLookupProtocol.failedID, enrollmentID: nil)
            XCTFail("A failed lookup must stop editing, not overwrite an existing log")
        } catch { }
    }

    func testSignedOutLookupFailsClosed() async throws {
        let backend = try await backend(signedIn: false)
        do {
            _ = try await backend.log(workoutID: LogLookupProtocol.workoutID, enrollmentID: nil)
            XCTFail("A missing session must not look like a new workout")
        } catch { }
    }
}

@MainActor
final class BookingAccessTests: XCTestCase {
    func testOwnedRefreshSurvivesGestureCancellation() async throws {
        let model = try await model()
        let refresh = ViewRefreshTask<Bool>()
        let gesture = Task {
            await refresh.run {
                do {
                    try await model.refreshBookingAccess()
                    return true
                } catch { return false }
            }
        }
        gesture.cancel()
        let applied = await gesture.value
        XCTAssertTrue(applied)
        XCTAssertEqual(model.entitlements.classCredits, 7)
    }

    func testNewRefreshCancelsSupersededWork() async {
        let refresh = ViewRefreshTask<Bool>()
        let started = expectation(description: "first refresh started")
        let first = Task {
            await refresh.run {
                started.fulfill()
                try? await Task.sleep(for: .seconds(30))
                return !Task.isCancelled
            }
        }
        await fulfillment(of: [started], timeout: 2)
        let latest = await refresh.run { true }
        let superseded = await first.value
        XCTAssertTrue(latest)
        XCTAssertFalse(superseded)
    }

    func testDisappearingViewCancelsOwnedRefresh() async {
        let refresh = ViewRefreshTask<Bool>()
        let started = expectation(description: "refresh started")
        let work = Task {
            await refresh.run {
                started.fulfill()
                try? await Task.sleep(for: .seconds(30))
                return Task.isCancelled
            }
        }
        await fulfillment(of: [started], timeout: 2)
        refresh.cancel()
        let cancelled = await work.value
        XCTAssertTrue(cancelled)
    }

    private func model(signedIn: Bool = true) async throws -> AppModel {
        BookingAccessProtocol.credits = 7
        BookingAccessProtocol.failing = false
        BookingAccessProtocol.unsignedWaiver = false
        let session = URLSessionConfiguration.ephemeral
        session.protocolClasses = [BookingAccessProtocol.self]
        let url = URL(string: "https://booking-tests.invalid")!
        let model = AppModel(config: AppConfig(supabaseURL: url, supabaseAnonKey: "fixture", webBaseURL: url), options: .init(
            auth: .init(storage: TestAuthStorage(), autoRefreshToken: false, emitLocalSessionAsInitialSession: true),
            global: .init(session: URLSession(configuration: session))
        ))
        if signedIn { try await model.backend.signIn(email: "athlete@example.invalid", password: "fixture") }
        return model
    }

    func testRefreshReplacesCreditsAfterExternalPromotion() async throws {
        let model = try await model()
        try await model.refreshBookingAccess()
        XCTAssertEqual(model.entitlements.classCredits, 7)
        BookingAccessProtocol.credits = 6
        try await model.refreshBookingAccess()
        XCTAssertEqual(model.entitlements.classCredits, 6)
        XCTAssertEqual(model.entitlements.classCredits - 1, 5)
    }

    func testFailureDoesNotLeaveCachedBookingAccessAndRetryRecovers() async throws {
        let model = try await model()
        try await model.refreshBookingAccess()
        XCTAssertTrue(model.entitlements.canBookClasses)
        BookingAccessProtocol.failing = true
        do {
            try await model.refreshBookingAccess()
            XCTFail("A failed balance lookup must not prepare a reservation")
        } catch { }
        XCTAssertFalse(model.entitlements.canBookClasses)
        BookingAccessProtocol.failing = false
        BookingAccessProtocol.credits = 6
        try await model.refreshBookingAccess()
        XCTAssertEqual(model.entitlements.classCredits, 6)
    }

    func testPreparationRefreshesRequiredWaiversToo() async throws {
        let model = try await model()
        try await model.refreshBookingAccess()
        XCTAssertFalse(model.needsWaiver)
        BookingAccessProtocol.unsignedWaiver = true
        try await model.refreshBookingAccess()
        XCTAssertTrue(model.needsWaiver)
    }

    func testSignedOutPreparationFailsClosed() async throws {
        let model = try await model(signedIn: false)
        do {
            try await model.refreshBookingAccess()
            XCTFail("No reservation preview may use a missing account")
        } catch { }
        XCTAssertFalse(model.entitlements.canBookClasses)
    }
}

private final class BookingAccessProtocol: URLProtocol {
    static var credits = 7
    static var failing = false
    static var unsignedWaiver = false

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let url = request.url!
        XCTAssertEqual(url.host, "booking-tests.invalid")
        var status = 200
        let body: String
        switch url.path {
        case "/auth/v1/token":
            body = """
            {"access_token":"fixture-access-token","token_type":"bearer","expires_in":3600,"expires_at":\(Date().timeIntervalSince1970 + 3600),"refresh_token":"fixture-refresh-token","user":{"id":"\(LogLookupProtocol.userID)","aud":"authenticated","role":"authenticated","app_metadata":{},"user_metadata":{},"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}}
            """
        case "/rest/v1/memberships":
            if Self.failing {
                status = 403
                body = "{\"code\":\"42501\",\"message\":\"permission denied\"}"
            } else {
                body = """
                [{"id":"00000000-0000-4000-a000-000000000020","status":"active","cancel_at_period_end":false,"credits_remaining":\(Self.credits),"membership_plans":{"name":"Class pack","kind":"class_pack"}}]
                """
            }
        case "/rest/v1/waivers" where Self.unsignedWaiver:
            body = """
            [{"id":"00000000-0000-4000-a000-000000000030","title":"Updated waiver","body":"Updated terms","version":1}]
            """
        case "/rest/v1/waivers", "/rest/v1/waiver_signatures": body = "[]"
        default:
            XCTFail("Unexpected booking-access request: \(url.path)")
            body = "[]"
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class TransactionRetryTests: XCTestCase {
    private func backend(failures: Int = 1, code: String = "40P01", networkFailure: Bool = false) async throws -> Backend {
        TransactionRetryProtocol.configure(failures: failures, code: code, networkFailure: networkFailure)
        let session = URLSessionConfiguration.ephemeral
        session.protocolClasses = [TransactionRetryProtocol.self]
        let url = URL(string: "https://transaction-tests.invalid")!
        let backend = Backend(config: AppConfig(supabaseURL: url, supabaseAnonKey: "fixture", webBaseURL: url), options: .init(
            auth: .init(storage: TestAuthStorage(), autoRefreshToken: false, emitLocalSessionAsInitialSession: true),
            global: .init(session: URLSession(configuration: session))
        ))
        try await backend.signIn(email: "athlete@example.invalid", password: "fixture")
        return backend
    }

    func testCancellationRetriesRolledBackTransactionsWithTheSameBody() async throws {
        let backend = try await backend(failures: 2)
        let booking = UUID()
        try await backend.cancelBooking(id: booking)
        let requests = TransactionRetryProtocol.requests
        XCTAssertEqual(requests.count, 3)
        for request in requests {
            XCTAssertEqual(request.method, "POST")
            XCTAssertEqual(request.authorization, "Bearer fixture-access-token")
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: request.body) as? [String: String])
            XCTAssertEqual(payload["p_booking"]?.lowercased(), booking.uuidString.lowercased())
        }
    }

    func testReturningBookingRPCAlsoRetries() async throws {
        let backend = try await backend()
        let status = try await backend.book(sessionID: UUID())
        XCTAssertEqual(status, .booked)
        XCTAssertEqual(TransactionRetryProtocol.requests.count, 2)
    }

    func testRepeatedDeadlocksStopAfterThreeAttempts() async throws {
        let backend = try await backend(failures: 10)
        do { try await backend.cancelBooking(id: UUID()); XCTFail("Must stop retrying") }
        catch let error as PostgrestError { XCTAssertEqual(error.code, "40P01") }
        XCTAssertEqual(TransactionRetryProtocol.requests.count, 3)
    }

    func testBusinessAndNetworkFailuresAreNeverReplayed() async throws {
        for code in ["42501", "23505", "P0001", "40001"] {
            let backend = try await backend(code: code)
            do { try await backend.cancelBooking(id: UUID()); XCTFail("Must preserve the error") }
            catch let error as PostgrestError { XCTAssertEqual(error.code, code) }
            XCTAssertEqual(TransactionRetryProtocol.requests.count, 1)
        }
        let backend = try await backend(networkFailure: true)
        do { try await backend.cancelBooking(id: UUID()); XCTFail("The commit outcome is unknown") }
        catch { XCTAssertTrue(error is URLError) }
        XCTAssertEqual(TransactionRetryProtocol.requests.count, 1)
    }

    func testCancellationStopsRetries() async throws {
        let backend = try await backend()
        let failed = expectation(description: "first attempt failed")
        TransactionRetryProtocol.onFailure = { failed.fulfill() }
        let task = Task { try await backend.cancelBooking(id: UUID()) }
        await fulfillment(of: [failed], timeout: 2)
        task.cancel()
        do { try await task.value; XCTFail("Cancelled work must not replay") } catch { }
        XCTAssertEqual(TransactionRetryProtocol.requests.count, 1)
    }

    func testAccountChangeStopsRetries() async throws {
        let backend = try await backend()
        let failed = expectation(description: "first attempt failed")
        TransactionRetryProtocol.onFailure = { failed.fulfill() }
        let task = Task { try await backend.cancelBooking(id: UUID()) }
        await fulfillment(of: [failed], timeout: 2)
        await backend.signOut()
        do { try await task.value; XCTFail("Must not replay for a different auth session") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(TransactionRetryProtocol.requests.count, 1)
    }
}

private final class TransactionRetryProtocol: URLProtocol {
    struct RecordedRequest {
        let method: String?
        let authorization: String?
        let body: Data
    }
    private static let lock = NSLock()
    private static var recorded: [RecordedRequest] = []
    private static var failures = 0
    private static var code = "40P01"
    private static var networkFailure = false
    static var onFailure: (() -> Void)?
    static var requests: [RecordedRequest] { lock.lock(); defer { lock.unlock() }; return recorded }
    static func configure(failures: Int, code: String, networkFailure: Bool) {
        lock.lock(); defer { lock.unlock() }
        recorded = []; self.failures = failures; self.code = code; self.networkFailure = networkFailure; onFailure = nil
    }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "transaction-tests.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        let url = request.url!
        var status = 200
        var body = "{}"
        var callback: (() -> Void)?
        if url.path == "/auth/v1/token" {
            body = """
            {"access_token":"fixture-access-token","token_type":"bearer","expires_in":3600,"expires_at":\(Date().timeIntervalSince1970 + 3600),"refresh_token":"fixture-refresh-token","user":{"id":"00000000-0000-4000-a000-000000000001","aud":"authenticated","role":"authenticated","app_metadata":{},"user_metadata":{},"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}}
            """
        } else if url.path.hasPrefix("/rest/v1/") {
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while true {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    data.append(contentsOf: buffer.prefix(count))
                }
            }
            Self.lock.lock()
            Self.recorded.append(RecordedRequest(method: request.httpMethod, authorization: request.value(forHTTPHeaderField: "Authorization"), body: data))
            let failed = Self.recorded.count <= Self.failures
            let networkFailure = Self.networkFailure
            if failed { status = 500; body = "{\"code\":\"\(Self.code)\",\"message\":\"transaction rejected\"}"; callback = Self.onFailure }
            else { body = "{\"id\":\"00000000-0000-4000-a000-000000000002\",\"status\":\"booked\"}" }
            Self.lock.unlock()
            if networkFailure { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)); return }
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
        callback?()
    }
}

private final class TestAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    func store(key: String, value: Data) { lock.lock(); defer { lock.unlock() }; values[key] = value }
    func retrieve(key: String) -> Data? { lock.lock(); defer { lock.unlock() }; return values[key] }
    func remove(key: String) { lock.lock(); defer { lock.unlock() }; values[key] = nil }
}

private final class LogLookupProtocol: URLProtocol {
    static let userID = UUID(uuidString: "00000000-0000-4000-a000-000000000001")!
    static let workoutID = UUID(uuidString: "00000000-0000-4000-a000-000000000002")!
    static let enrollmentID = UUID(uuidString: "00000000-0000-4000-a000-000000000003")!
    static let itemID = UUID(uuidString: "00000000-0000-4000-a000-000000000004")!
    static let missingID = UUID(uuidString: "00000000-0000-4000-a000-000000000005")!
    static let failedID = UUID(uuidString: "00000000-0000-4000-a000-000000000006")!
    static var workout: Workout {
        let data = Data("""
        {"id":"\(workoutID)","title":"Old workout","workout_items":[{"id":"\(itemID)","position":1,"title":"Squat","metrics":["load","reps"]}]}
        """.utf8)
        return try! JSONCoding.decoder().decode(Workout.self, from: data)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let url = request.url!
        XCTAssertEqual(url.host, "workout-tests.invalid")
        var status = 200
        let body: String
        if url.path == "/auth/v1/token" {
            body = """
            {"access_token":"fixture-access-token","token_type":"bearer","expires_in":3600,"expires_at":\(Date().timeIntervalSince1970 + 3600),"refresh_token":"fixture-refresh-token","user":{"id":"\(Self.userID)","aud":"authenticated","role":"authenticated","app_metadata":{},"user_metadata":{},"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}}
            """
        } else {
            XCTAssertEqual(url.path, "/rest/v1/workout_logs")
            let params = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
            XCTAssertEqual(params["user_id"]?.lowercased(), "eq.\(Self.userID.uuidString.lowercased())")
            XCTAssertNil(params["limit"])
            XCTAssertNil(params["performed_on"])
            let enrollment = params["enrollment_id"] ?? ""
            XCTAssertTrue(["is.null", "eq.\(Self.enrollmentID.uuidString.lowercased())"].contains(enrollment.lowercased()))
            if params["workout_id"]?.lowercased() == "eq.\(Self.failedID.uuidString.lowercased())" {
                status = 403
                body = "{\"code\":\"42501\",\"message\":\"permission denied\"}"
            } else if params["workout_id"]?.lowercased() == "eq.\(Self.missingID.uuidString.lowercased())" {
                body = "[]"
            } else {
                XCTAssertEqual(params["workout_id"]?.lowercased(), "eq.\(Self.workoutID.uuidString.lowercased())")
                let context = enrollment == "is.null" ? "null" : "\"\(Self.enrollmentID)\""
                body = """
                [{"id":"00000000-0000-4000-a000-000000000010","workout_id":"\(Self.workoutID)","enrollment_id":\(context),"performed_on":"2000-01-01","notes":"Keep this old note","rpe":7.5,"workout_log_entries":[{"id":"00000000-0000-4000-a000-000000000011","workout_item_id":"\(Self.itemID)","set_index":1,"load":200.5,"load_unit":"lb","reps":5,"is_pr":false},{"id":"00000000-0000-4000-a000-000000000012","workout_item_id":"\(Self.itemID)","set_index":2,"load":190.5,"load_unit":"lb","reps":6,"is_pr":false}],"coach_feedback":[]}]
                """
            }
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}
