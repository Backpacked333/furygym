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
