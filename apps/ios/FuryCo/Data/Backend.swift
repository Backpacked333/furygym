import Foundation
import FuryCore
import Supabase

/// Every network call the app makes. Reads and writes go straight to Supabase under row-level
/// security; payments and account deletion go through the Fury Co. web app.
///
/// The `select` lists here are mirrored in scripts/refresh-fixtures.mjs, whose captured responses
/// are what FuryCore's decoding tests run against. Change both together.
struct Backend: Sendable {
    let client: SupabaseClient
    let webBaseURL: URL

    init(config: AppConfig, options: SupabaseClientOptions = .init(auth: .init(emitLocalSessionAsInitialSession: true))) {
        client = SupabaseClient(
            supabaseURL: config.supabaseURL,
            supabaseKey: config.supabaseAnonKey,
            options: options
        )
        webBaseURL = config.webBaseURL
    }

    // MARK: Plumbing

    /// Runs a query and decodes the body with FuryCore's decoder (snake_case keys, Postgres dates).
    private func fetch<T: Decodable>(_ builder: PostgrestBuilder, as type: T.Type = T.self) async throws -> T {
        let response: PostgrestResponse<Void> = try await builder.execute()
        return try JSONCoding.decoder().decode(T.self, from: response.data)
    }

    private func run(_ builder: PostgrestBuilder) async throws {
        let _: PostgrestResponse<Void> = try await builder.execute()
    }

    /// A sentence for the athlete, from whatever went wrong.
    static func message(for error: Error) -> String {
        if let postgrest = error as? PostgrestError {
            return ServerMessage.friendly(postgrest.message)
        }
        if let web = error as? WebError {
            return web.message
        }
        if let validation = error as? LogValidationError {
            return validation.description
        }
        if (error as? URLError) != nil {
            return "No connection. Check your signal and try again."
        }
        let text = error.localizedDescription
        return ServerMessage.isKnown(text) ? ServerMessage.friendly(text) : text
    }

    // MARK: Account

    var currentUserID: UUID? { client.auth.currentUser?.id }

    func signIn(email: String, password: String) async throws {
        try await client.auth.signIn(email: email, password: password)
    }

    /// Returns true when the account still needs its email address confirmed before signing in.
    func signUp(fullName: String, email: String, password: String) async throws -> Bool {
        let response = try await client.auth.signUp(email: email, password: password, data: ["full_name": .string(fullName)])
        if case .session = response { return false }
        return true
    }

    func signOut() async {
        try? await client.auth.signOut()
    }

    func gym() async throws -> Gym {
        let rows: [Gym] = try await fetch(
            client.from("gyms")
                .select("id,name,timezone,booking_window_days,cancel_cutoff_minutes,ios_program_purchase_link,milestone_visits,milestone_reward")
                .eq("is_default", value: true)
        )
        guard let gym = rows.first else { throw WebError(message: "The gym could not be loaded.") }
        return gym
    }

    func profile(userID: UUID) async throws -> Profile? {
        let rows: [Profile] = try await fetch(
            client.from("profiles")
                .select("id,email,full_name,phone,units,emergency_contact_name,emergency_contact_phone")
                .eq("id", value: userID)
        )
        return rows.first
    }

    struct ProfileUpdate: Encodable {
        var fullName: String
        var phone: String?
        var units: String
        var emergencyContactName: String?
        var emergencyContactPhone: String?

        enum CodingKeys: String, CodingKey {
            case fullName = "full_name", phone, units
            case emergencyContactName = "emergency_contact_name", emergencyContactPhone = "emergency_contact_phone"
        }
    }

    func updateProfile(userID: UUID, _ update: ProfileUpdate) async throws {
        try await run(client.from("profiles").update(update, returning: .minimal).eq("id", value: userID))
    }

    // MARK: Training

    private struct CalendarParams: Encodable {
        let from: String
        let to: String
        enum CodingKeys: String, CodingKey { case from = "p_from", to = "p_to" }
    }

    func calendar(from: DayDate, to: DayDate) async throws -> [CalendarEntry] {
        try await fetch(client.rpc("my_calendar", params: CalendarParams(from: from.description, to: to.description)))
    }

    private static let workoutColumns =
        "id,title,description,coach_notes,scheduled_date,workout_items(id,position,section,title,exercise_id,prescription,scaling,notes,video_url,metrics,benchmark_name)"

    func workout(id: UUID) async throws -> Workout? {
        let rows: [Workout] = try await fetch(client.from("workouts").select(Backend.workoutColumns).eq("id", value: id))
        return rows.first
    }

    private static let logColumns =
        "id,workout_id,enrollment_id,performed_on,notes,rpe,workouts(title),workout_log_entries(id,workout_item_id,exercise_id,benchmark_name,set_index,load,load_unit,sets,reps,time_seconds,distance_m,pace_seconds,pace_unit,splits,rpe,comments,is_pr),coach_feedback(id,body,created_at)"

    func recentLogs(limit: Int = 30) async throws -> [WorkoutLog] {
        guard let userID = currentUserID else { return [] }
        return try await fetch(
            client.from("workout_logs").select(Backend.logColumns)
                .eq("user_id", value: userID)
                .order("performed_on", ascending: false)
                .limit(limit)
        )
    }

    func log(workoutID: UUID, enrollmentID: UUID?) async throws -> WorkoutLog? {
        guard let userID = currentUserID else { throw WebError(message: "Sign in to load your workout log.") }
        var query = client.from("workout_logs").select(Backend.logColumns)
            .eq("user_id", value: userID)
            .eq("workout_id", value: workoutID)
        if let enrollmentID {
            query = query.eq("enrollment_id", value: enrollmentID)
        } else {
            query = query.is("enrollment_id", value: nil)
        }
        let rows: [WorkoutLog] = try await fetch(query)
        return rows.first
    }

    /// Published workouts on a date, optionally for one track — the preview on a class's page.
    func workouts(on date: DayDate, trackID: UUID?) async throws -> [Workout] {
        var query = client.from("workouts").select(Backend.workoutColumns).eq("scheduled_date", value: date.description)
        if let trackID { query = query.eq("track_id", value: trackID) }
        return try await fetch(query)
    }

    func log(id: UUID) async throws -> WorkoutLog? {
        let rows: [WorkoutLog] = try await fetch(client.from("workout_logs").select(Backend.logColumns).eq("id", value: id))
        return rows.first
    }

    private struct SubmitParams: Encodable {
        let workout: UUID
        let performedOn: String
        let entries: [LogEntryPayload]
        let enrollment: UUID?
        let notes: String?
        let rpe: Double?

        enum CodingKeys: String, CodingKey {
            case workout = "p_workout", performedOn = "p_performed_on", entries = "p_entries"
            case enrollment = "p_enrollment", notes = "p_notes", rpe = "p_rpe"
        }
    }

    func submitLog(workoutID: UUID, enrollmentID: UUID?, performedOn: DayDate, submission: LogSubmission) async throws -> LogResult {
        let params = SubmitParams(
            workout: workoutID, performedOn: performedOn.description, entries: submission.entries,
            enrollment: enrollmentID, notes: submission.notes, rpe: submission.rpe
        )
        return try await fetch(client.rpc("submit_workout_log", params: params))
    }

    func deleteLog(id: UUID) async throws {
        try await run(client.from("workout_logs").delete(returning: .minimal).eq("id", value: id))
    }

    // MARK: Classes

    func classes(from: Date, to: Date) async throws -> [ClassSession] {
        try await fetch(
            client.from("class_session_overview")
                .select("id,title,starts_at,ends_at,capacity,status,track_name,track_color,coach_name,booked_count,waitlist_count,my_booking_id,my_booking_status,my_waitlist_position,track_id")
                .gte("starts_at", value: Timestamp.format(from))
                .lt("starts_at", value: Timestamp.format(to))
                .order("starts_at")
        )
    }

    private struct SessionParam: Encodable {
        let session: UUID
        enum CodingKeys: String, CodingKey { case session = "p_session" }
    }

    private struct BookingParam: Encodable {
        let booking: UUID
        enum CodingKeys: String, CodingKey { case booking = "p_booking" }
    }

    private struct BookingRow: Decodable {
        let id: UUID
        let status: BookingStatus
    }

    /// Books the class, or joins the waitlist when it is full. Returns the resulting status.
    func book(sessionID: UUID) async throws -> BookingStatus {
        let row: BookingRow = try await fetch(client.rpc("book_class", params: SessionParam(session: sessionID)))
        return row.status
    }

    func cancelBooking(id: UUID) async throws {
        try await run(client.rpc("cancel_booking", params: BookingParam(booking: id)))
    }

    // MARK: Check-in

    func attendance() async throws -> Attendance {
        try await fetch(client.rpc("my_attendance"))
    }

    /// The secret behind this athlete's rotating check-in code. Created on first use.
    func checkInSecret() async throws -> String {
        try await fetch(client.rpc("my_checkin_secret"))
    }

    // MARK: Memberships, programs and waivers

    func plans() async throws -> [MembershipPlan] {
        try await fetch(
            client.from("membership_plans")
                .select("id,name,description,kind,price_cents,currency,billing_interval,class_credits,duration_days")
                .order("position")
        )
    }

    func memberships() async throws -> [Membership] {
        guard let userID = currentUserID else { return [] }
        return try await fetch(
            client.from("memberships")
                .select("id,status,started_at,current_period_end,ends_at,cancel_at_period_end,frozen_until,credits_remaining,stripe_subscription_id,membership_plans(name,kind,price_cents,currency,billing_interval)")
                .eq("user_id", value: userID)
                .order("created_at", ascending: false)
        )
    }

    private static let programColumns = "id,name,slug,summary,description,duration_weeks,days_per_week,price_cents,currency,unlock_mode,grace_days"

    func programs() async throws -> [Program] {
        try await fetch(client.from("programs").select(Backend.programColumns).eq("status", value: "published").order("position"))
    }

    func enrollments() async throws -> [Enrollment] {
        guard let userID = currentUserID else { return [] }
        return try await fetch(
            client.from("enrollments")
                .select("id,program_id,start_date,expires_at,status,programs(\(Backend.programColumns))")
                .eq("user_id", value: userID)
                .order("created_at", ascending: false)
        )
    }

    private struct StartParams: Encodable {
        let enrollment: UUID
        let start: String
        enum CodingKeys: String, CodingKey { case enrollment = "p_enrollment", start = "p_start" }
    }

    func setStartDate(enrollmentID: UUID, to date: DayDate) async throws {
        try await run(client.rpc("set_enrollment_start", params: StartParams(enrollment: enrollmentID, start: date.description)))
    }

    /// Required waivers the athlete has not signed yet.
    func unsignedWaivers() async throws -> [Waiver] {
        guard let userID = currentUserID else { return [] }
        struct Signature: Decodable { let waiverId: UUID }
        async let waivers: [Waiver] = fetch(
            client.from("waivers").select("id,title,body,version").eq("active", value: true).eq("required", value: true)
        )
        async let signed: [Signature] = fetch(client.from("waiver_signatures").select("waiver_id").eq("user_id", value: userID))
        let signedRows = try await signed
        let allWaivers = try await waivers
        let signedIDs = Set(signedRows.map(\.waiverId))
        return allWaivers.filter { !signedIDs.contains($0.id) }
    }

    private struct SignParams: Encodable {
        let waiver: UUID
        let signedName: String
        enum CodingKeys: String, CodingKey { case waiver = "p_waiver", signedName = "p_signed_name" }
    }

    func sign(waiverID: UUID, name: String) async throws {
        try await run(client.rpc("sign_waiver", params: SignParams(waiver: waiverID, signedName: name)))
    }

    // MARK: Progress

    func personalRecords() async throws -> [PersonalRecord] {
        guard let userID = currentUserID else { return [] }
        return try await fetch(
            client.from("personal_records")
                .select("exercise_id,exercise_name,reps,load,load_unit,load_kg,performed_on")
                .eq("user_id", value: userID)
                .order("exercise_name")
        )
    }

    func benchmarkResults() async throws -> [BenchmarkResult] {
        guard let userID = currentUserID else { return [] }
        return try await fetch(
            client.from("benchmark_results")
                .select("id,benchmark_name,time_seconds,reps,load,load_unit,distance_m,is_pr,performed_on")
                .eq("user_id", value: userID)
                .order("performed_on")
        )
    }

    func liftSamples(exerciseID: UUID) async throws -> [LiftSample] {
        guard let userID = currentUserID else { return [] }
        return try await fetch(
            client.from("workout_log_entries")
                .select("exercise_id,load_kg,reps,performed_on")
                .eq("user_id", value: userID)
                .eq("exercise_id", value: exerciseID)
                .not("load_kg", operator: .is, value: "null")
                .order("performed_on")
        )
    }

    /// Every loaded set the athlete has logged, for trends and the "last time" hint.
    func allLiftSamples() async throws -> [LiftSample] {
        guard let userID = currentUserID else { return [] }
        return try await fetch(
            client.from("workout_log_entries")
                .select("exercise_id,load_kg,reps,performed_on")
                .eq("user_id", value: userID)
                .not("load_kg", operator: .is, value: "null")
                .not("exercise_id", operator: .is, value: "null")
                .order("performed_on")
        )
    }

    func payments() async throws -> [Payment] {
        guard let userID = currentUserID else { return [] }
        return try await fetch(
            client.from("payments")
                .select("id,description,amount_cents,refunded_cents,currency,status,paid_at,created_at")
                .eq("user_id", value: userID)
                .order("created_at", ascending: false)
        )
    }

    // MARK: Web app (payments and account deletion)

    struct WebError: Error {
        let message: String
    }

    private struct WebReply: Decodable {
        let url: String?
        let message: String?
        let error: String?
    }

    private func post(_ path: String, body: [String: Any]) async throws -> WebReply {
        let token = try await client.auth.session.accessToken
        var request = URLRequest(url: webBaseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let reply = (try? JSONDecoder().decode(WebReply.self, from: data)) ?? WebReply(url: nil, message: nil, error: nil)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw WebError(message: reply.message ?? "Something went wrong. Please try again.")
        }
        return reply
    }

    enum Purchase {
        case plan(UUID)
        case program(UUID, start: DayDate)
    }

    /// Asks the web app for a Stripe Checkout page. The page is opened in an in-app browser and
    /// returns through the `furyco://` link.
    func checkoutURL(for purchase: Purchase) async throws -> URL {
        var body: [String: Any] = ["return_to": "app"]
        switch purchase {
        case .plan(let id):
            body["kind"] = "plan"
            body["id"] = id.uuidString.lowercased()
        case .program(let id, let start):
            body["kind"] = "program"
            body["id"] = id.uuidString.lowercased()
            body["start_date"] = start.description
        }
        let reply = try await post("api/stripe/checkout", body: body)
        guard let url = reply.url.flatMap(URL.init(string:)) else { throw WebError(message: "Checkout could not be started.") }
        return url
    }

    func billingPortalURL() async throws -> URL {
        let reply = try await post("api/stripe/portal", body: ["return_to": "app"])
        guard let url = reply.url.flatMap(URL.init(string:)) else { throw WebError(message: "Billing could not be opened.") }
        return url
    }

    /// Permanently deletes the account. Billing is stopped first by the server.
    func deleteAccount() async throws {
        _ = try await post("api/account/delete", body: [:])
        try? await client.auth.signOut(scope: .local)
    }

    enum MembershipChange {
        case freeze(weeks: Int)
        case resume
        case cancel
    }

    /// Freeze, resume or cancel (at the end of the paid period) the athlete's own membership.
    func change(membershipID: UUID, _ change: MembershipChange) async throws {
        var body: [String: Any] = ["membership_id": membershipID.uuidString.lowercased()]
        switch change {
        case .freeze(let weeks):
            body["action"] = "freeze"
            body["weeks"] = weeks
        case .resume: body["action"] = "resume"
        case .cancel: body["action"] = "cancel"
        }
        _ = try await post("api/membership", body: body)
    }

    func programPageURL(slug: String) -> URL {
        webBaseURL.appendingPathComponent("programs").appendingPathComponent(slug)
    }
}
