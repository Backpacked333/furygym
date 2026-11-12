import FuryCore
import SwiftUI

/// Screens reachable from the profile and from prompts elsewhere in the app.
enum AccountRoute: Hashable {
    case profile, membership, billing, waiver, purchases, settings, programs
    case program(UUID)

    @ViewBuilder var destination: some View {
        switch self {
        case .profile: ProfileView()
        case .membership: MembershipView()
        case .billing: BillingView()
        case .waiver: WaiverView()
        case .purchases: PurchasesView()
        case .settings: SettingsView()
        case .programs: ProgramsView()
        case .program(let id): ProgramPlanView(enrollmentID: id)
        }
    }
}

private struct BackButton: ToolbarContent {
    @Environment(\.dismiss) private var dismiss

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) { GlassIconButton(systemName: "chevron.left", label: "Back") { dismiss() } }
    }
}

extension View {
    /// Hides the system back button and bar background in favour of the glass back button.
    func fcNavigation(title: String = "") -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden()
            .toolbar { BackButton() }
            .toolbarBackground(.hidden, for: .navigationBar)
    }
}

/// One identity for gym membership and online programs, with rewards and records of purchases.
struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @State private var enrollments: [Enrollment] = []
    @State private var error: String?
    @State private var opening = false

    private var membership: Membership? { model.memberships.first(where: \.isLive) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 14) {
                    Text(model.initials).font(.title2.weight(.bold)).frame(width: 72, height: 72).background(FC.redFill.opacity(0.45), in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.profile?.fullName.isEmpty == false ? model.profile!.fullName : "Your account").font(.title2.bold())
                        Text([model.profile?.email, model.gym?.name].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(FC.label2).lineLimit(1)
                    }
                }

                membershipCard
                ErrorText(message: error)

                ListHeader(text: "Entitlements & rewards")
                ListGroup {
                    ForEach(enrollments.filter { $0.status == .active }) { enrollment in
                        NavigationLink(value: AccountRoute.program(enrollment.id)) {
                            ListRow(systemImage: "figure.hiking", iconColor: FC.indigo, title: enrollment.programs?.name ?? "Program",
                                    subtitle: "Started \(DateText.shortDay(enrollment.startDate, in: model.timeZone))\(enrollment.expiresAt.map { " · to \(DateText.shortDay($0, in: model.timeZone))" } ?? "")")
                        }
                        .buttonStyle(.plain)
                    }
                    NavigationLink(value: AccountRoute.programs) {
                        ListRow(systemImage: "square.grid.2x2.fill", iconColor: FC.indigo, title: "Online programs", subtitle: "Train anywhere")
                    }
                    .buttonStyle(.plain)
                    ListRow(systemImage: "medal.fill", iconColor: Color(hex: "#A98500"), title: "Rewards", value: "\(model.milestone.visits) / \(model.milestone.target) visits", showChevron: false, isLast: true)
                }

                ListGroup {
                    NavigationLink(value: AccountRoute.purchases) { ListRow(systemImage: "receipt.fill", title: "Purchase history") }.buttonStyle(.plain)
                    Button { Task { await openPortal() } } label: {
                        ListRow(systemImage: "creditcard.fill", title: "Payment methods", value: opening ? "Opening…" : nil)
                    }
                    .buttonStyle(.plain)
                    NavigationLink(value: AccountRoute.waiver) {
                        ListRow(systemImage: "doc.text.fill", title: "Agreements & waivers", value: model.needsWaiver ? "To sign" : "Signed", isLast: true)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .screenBackground()
        .fcNavigation()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: AccountRoute.settings) {
                    Image(systemName: "gearshape.fill").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                        .frame(width: 44, height: 44).background(GlassBackground(shape: Circle()))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Settings")
            }
        }
        .task(id: model.revision) { enrollments = (try? await model.backend.enrollments()) ?? [] }
        .refreshable { await model.refreshAccount() }
    }

    @ViewBuilder private var membershipCard: some View {
        if let membership {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    statusChip(membership)
                    Spacer()
                    Wordmark(size: 13)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(membership.planName).font(.title2.bold())
                    Text(MembershipText.summary(membership, timeZone: model.timeZone)).font(.subheadline).foregroundStyle(FC.label2)
                }
                NavigationLink(value: AccountRoute.membership) { Text("Manage membership").frame(maxWidth: .infinity) }
                    .buttonStyle(.fc(.gray, size: .medium))
            }
            .padding(16)
            .background {
                ZStack {
                    FC.bg2
                    RadialGradient(colors: [FC.redFill.opacity(0.35), .clear], center: .topTrailing, startRadius: 0, endRadius: 260)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
        } else {
            FCard {
                Text("No membership yet").font(.headline)
                Text("Join the gym to book classes and follow the daily programming.").font(.footnote).foregroundStyle(FC.label2)
                Button("Join the gym") { model.flow = .joinGym }.buttonStyle(.fc(.filled, size: .medium, fullWidth: false))
            }
        }
    }

    private func statusChip(_ membership: Membership) -> some View {
        switch membership.status {
        case .pastDue: return Chip(text: "Past due", color: FC.orange, systemImage: "exclamationmark.circle.fill")
        case .frozen: return Chip(text: "Frozen", color: FC.indigo, systemImage: "snowflake")
        default: return Chip(text: membership.cancelAtPeriodEnd ? "Canceling" : "Active", color: membership.cancelAtPeriodEnd ? FC.gray : FC.green, systemImage: "checkmark.circle.fill")
        }
    }

    private func openPortal() async {
        opening = true
        defer { opening = false }
        error = await model.openBillingPortal()
    }
}

enum MembershipText {
    /// "Renews Dec 1 · $189.00/mo", "Ends Dec 10", "3 classes left · valid until Jan 5"
    static func summary(_ membership: Membership, timeZone: TimeZone) -> String {
        var parts: [String] = []
        if membership.status == .frozen {
            parts.append(membership.frozenUntil.map { "Resumes \(DateText.shortDay($0, in: timeZone))" } ?? "Frozen")
        } else if let credits = membership.creditsRemaining {
            parts.append(credits == 1 ? "1 class left" : "\(credits) classes left")
            if let ends = membership.endsAt { parts.append("valid until \(DateText.date(ends, in: timeZone))") }
        } else if membership.cancelAtPeriodEnd, let ends = membership.endsAt {
            parts.append("Ends \(DateText.date(ends, in: timeZone))")
        } else if let renews = membership.currentPeriodEnd {
            parts.append("Renews \(DateText.date(renews, in: timeZone))")
        } else if let ends = membership.endsAt {
            parts.append("Valid until \(DateText.date(ends, in: timeZone))")
        }
        if membership.creditsRemaining == nil, let price = membership.membershipPlans?.priceLabel { parts.append(price) }
        return parts.joined(separator: " · ")
    }
}

/// Change, freeze or cancel — self-serve, with the policy shown before anything happens.
struct MembershipView: View {
    @Environment(AppModel.self) private var model
    @State private var freezing = false
    @State private var confirmCancel = false
    @State private var working = false
    @State private var error: String?
    @State private var notice: String?

    private var membership: Membership? { model.memberships.first(where: \.isLive) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let membership {
                    FCard {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(membership.planName).font(.title2.bold())
                                Text(membership.startedAt.map { "Since \(DateText.date($0, in: model.timeZone))" } ?? "").font(.footnote).foregroundStyle(FC.label2)
                            }
                            Spacer()
                            if let price = membership.membershipPlans?.priceLabel { Text(price).font(FC.metric(22)) }
                        }
                        FC.separator.frame(height: 0.5)
                        row("Status", MembershipText.summary(membership, timeZone: model.timeZone))
                        row("Classes this month", "\(model.attendance.visitsThisMonth) attended")
                    }

                    ErrorText(message: error)
                    if let notice { Text(notice).font(.footnote).foregroundStyle(FC.green).padding(.horizontal, 4) }

                    ListHeader(text: "Options")
                    ListGroup {
                        Button { Task { await portal() } } label: {
                            ListRow(systemImage: "arrow.left.arrow.right", title: "Change plan", subtitle: "Takes effect on your next billing date")
                        }
                        .buttonStyle(.plain)
                        if membership.isRecurring {
                            if membership.status == .frozen {
                                Button { Task { await change(.resume, done: "Welcome back — your membership is active again.") } } label: {
                                    ListRow(systemImage: "snowflake", iconColor: Color(hex: "#0A84FF"), title: "Resume membership", subtitle: "End your freeze now")
                                }
                                .buttonStyle(.plain)
                            } else {
                                Button { freezing = true } label: {
                                    ListRow(systemImage: "snowflake", iconColor: Color(hex: "#0A84FF"), title: "Freeze membership", subtitle: "Pause billing for up to 2 months")
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        Button { Task { await portal() } } label: {
                            ListRow(systemImage: "creditcard.fill", title: "Update payment method", isLast: true)
                        }
                        .buttonStyle(.plain)
                    }
                    .disabled(working)

                    if membership.isRecurring && !membership.cancelAtPeriodEnd {
                        ListGroup {
                            Button { confirmCancel = true } label: {
                                ListRow(title: "Cancel membership", subtitle: "Stays active until the end of the period you have paid for", titleColor: FC.red, isLast: true)
                            }
                            .buttonStyle(.plain)
                        }
                        .disabled(working)
                    }
                    if !membership.isRecurring {
                        Text("This pass does not renew. Your credits remain available until its expiry date.")
                            .font(.footnote).foregroundStyle(FC.label2).padding(.horizontal, 16)
                    }
                    Text("Online programs you’ve purchased stay active if you cancel your gym membership.")
                        .font(.footnote).foregroundStyle(FC.label2).padding(.horizontal, 16)
                } else {
                    FCard {
                        Text("No active membership").font(.headline)
                        Button("See memberships") { model.flow = .joinGym }.buttonStyle(.fc(.filled, size: .medium, fullWidth: false))
                    }
                }
            }
            .padding(16)
        }
        .screenBackground()
        .fcNavigation(title: "Membership")
        .sheet(isPresented: $freezing) {
            FreezeSheet { weeks in
                freezing = false
                await change(.freeze(weeks: weeks), done: "Membership frozen. Bookings during the freeze were released.")
            }
            .fcSheet(height: 460)
        }
        .confirmationDialog("Cancel your membership?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel membership", role: .destructive) { Task { await change(.cancel, done: "Your membership will end when the current period does.") } }
            Button("Keep my membership", role: .cancel) {}
        } message: {
            Text("You keep access until the end of the period you have already paid for. Nothing more will be charged.")
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(FC.label2)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }

    private func change(_ change: Backend.MembershipChange, done: String) async {
        guard let membership else { return }
        working = true
        error = nil
        notice = nil
        defer { working = false }
        do {
            try await model.backend.change(membershipID: membership.id, change)
            await model.refreshAccount()
            model.didChange()
            notice = done
        } catch {
            self.error = Backend.message(for: error)
        }
    }

    private func portal() async {
        working = true
        defer { working = false }
        error = await model.openBillingPortal()
    }
}

private struct FreezeSheet: View {
    @Environment(AppModel.self) private var model
    let confirm: (Int) async -> Void
    @State private var weeks = 4
    @State private var busy = false

    private let options: [(Int, String)] = [(2, "2 weeks"), (4, "1 month"), (8, "2 months")]

    var body: some View {
        let resumes = model.today.adding(days: weeks * 7)
        VStack(alignment: .leading, spacing: 16) {
            Text("Freeze membership").font(.title2.bold()).padding(.top, 8)
            HStack(spacing: 10) {
                ForEach(options, id: \.0) { value, label in
                    Button { weeks = value } label: {
                        Text(label).font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 60)
                            .background(weeks == value ? FC.red.opacity(0.16) : FC.bg3, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(weeks == value ? FC.red : .clear, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(weeks == value ? .isSelected : [])
                }
            }
            ListGroup {
                ListRow(title: "Starts", value: "Today", showChevron: false)
                ListRow(title: "Resumes", value: DateText.shortDay(resumes, in: model.timeZone), showChevron: false, isLast: true)
            }
            Label("Reservations before \(DateText.shortDay(resumes, in: model.timeZone)) will be released. Online programs aren’t affected.", systemImage: "calendar.badge.minus")
                .font(.footnote).foregroundStyle(FC.label2)
            Button(busy ? "Freezing…" : "Freeze for \(options.first { $0.0 == weeks }?.1 ?? "")") {
                busy = true
                Task {
                    await confirm(weeks)
                    busy = false
                }
            }
            .buttonStyle(.fcFilled)
            .disabled(busy)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }
}

/// Failed-payment recovery: say what happened, then hand off to the secure card form.
struct BillingView: View {
    @Environment(AppModel.self) private var model
    @State private var opening = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if model.entitlements.pastDue {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Payment didn’t go through", systemImage: "exclamationmark.circle.fill").font(.headline).foregroundStyle(.white)
                        Text("Your last membership payment was declined. You can keep booking while we retry — update your card to avoid losing access.")
                            .font(.subheadline).foregroundStyle(FC.label2)
                    }
                    .padding(16)
                    .background(FC.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous).stroke(FC.orange.opacity(0.35), lineWidth: 0.5))
                } else {
                    FCard {
                        Label("Billing is up to date", systemImage: "checkmark.circle.fill").font(.headline).foregroundStyle(FC.green)
                        Text("Manage your cards and see invoices in the secure billing page.").font(.footnote).foregroundStyle(FC.label2)
                    }
                }
                ListGroup {
                    ListRow(systemImage: "arrow.triangle.2.circlepath", title: "Automatic retries", subtitle: "Failed payments are retried over the following days", showChevron: false)
                    ListRow(systemImage: "lock.fill", title: "Card details stay with Stripe", subtitle: "They are never stored in this app", showChevron: false, isLast: true)
                }
                ErrorText(message: error)
            }
            .padding(16)
        }
        .screenBackground()
        .bottomBar {
            Button(opening ? "Opening…" : "Update payment method") {
                Task {
                    opening = true
                    error = await model.openBillingPortal()
                    opening = false
                }
            }
            .buttonStyle(.fcFilled)
            .disabled(opening)
        }
        .fcNavigation(title: "Billing")
    }
}

struct PurchasesView: View {
    @Environment(AppModel.self) private var model
    @State private var filter = 0

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: { try await model.backend.payments() }) { payments in
            let shown = payments.filter { payment in
                let isProgram = (payment.description ?? "").localizedCaseInsensitiveContains("week") || (payment.description ?? "").localizedCaseInsensitiveContains("prep")
                return filter == 0 || (filter == 2) == isProgram
            }
            let months = Dictionary(grouping: shown) { DateText.monthYear(DayDate($0.paidAt ?? $0.createdAt, in: model.timeZone), in: model.timeZone) }
            let order = shown.map { DateText.monthYear(DayDate($0.paidAt ?? $0.createdAt, in: model.timeZone), in: model.timeZone) }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(title: "Purchases")
                    PillSegmented(options: ["All", "Memberships", "Programs"], selection: $filter)
                    if shown.isEmpty { FCard { Text("No purchases yet.").foregroundStyle(FC.label2) } }
                    ForEach(order, id: \.self) { month in
                        ListHeader(text: month).padding(.top, 6)
                        ListGroup {
                            let rows = months[month] ?? []
                            ForEach(Array(rows.enumerated()), id: \.element.id) { index, payment in
                                let refunded = payment.refundedCents > 0
                                ListRow(
                                    systemImage: refunded ? "arrow.uturn.backward" : payment.status == "failed" ? "exclamationmark" : "creditcard.fill",
                                    iconColor: refunded ? FC.green.opacity(0.6) : payment.status == "failed" ? FC.orange : FC.redFill,
                                    title: payment.description ?? "Payment",
                                    subtitle: DateText.shortDay(DayDate(payment.paidAt ?? payment.createdAt, in: model.timeZone), in: model.timeZone) + (payment.status == "succeeded" ? "" : " · \(payment.status.replacingOccurrences(of: "_", with: " "))"),
                                    value: Format.money(cents: payment.amountCents, currency: payment.currency),
                                    showChevron: false, isLast: index == rows.count - 1
                                )
                            }
                        }
                    }
                }
                .padding(16)
            }
            .screenBackground()
        }
        .fcNavigation()
    }
}

/// Read and sign the gym's waiver. The signature is a typed full name, stored with the time and device.
struct WaiverView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.needsWaiver {
                AgreementStep {}
            } else {
                ContentUnavailableView("All signed", systemImage: "checkmark.seal.fill", description: Text("Nothing more to sign. You’re clear to book classes."))
            }
        }
        .screenBackground()
        .fcNavigation(title: "Agreements")
    }
}

/// Profile details, units, sign out and account deletion.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var fullName = ""
    @State private var phone = ""
    @State private var units: LoadUnit = .lb
    @State private var emergencyName = ""
    @State private var emergencyPhone = ""
    @State private var saving = false
    @State private var message: String?
    @State private var error: String?
    @State private var confirmDelete = false
    @State private var deleting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ListHeader(text: "You")
                FCField(placeholder: "Full name", text: $fullName, systemImage: "person").textContentType(.name)
                FCField(placeholder: "Phone", text: $phone, systemImage: "phone").textContentType(.telephoneNumber).keyboardType(.phonePad)
                Picker("Weights in", selection: $units) {
                    Text("Pounds (lb)").tag(LoadUnit.lb)
                    Text("Kilograms (kg)").tag(LoadUnit.kg)
                }
                .pickerStyle(.segmented)

                ListHeader(text: "Emergency contact").padding(.top, 6)
                FCField(placeholder: "Name", text: $emergencyName, systemImage: "person.2").textContentType(.name)
                FCField(placeholder: "Phone", text: $emergencyPhone, systemImage: "phone").textContentType(.telephoneNumber).keyboardType(.phonePad)

                ErrorText(message: error)
                if let message { Text(message).font(.footnote).foregroundStyle(FC.green) }
                Button(saving ? "Saving…" : "Save") { Task { await save() } }
                    .buttonStyle(.fcFilled)
                    .disabled(saving || fullName.trimmingCharacters(in: .whitespaces).count < 2)

                ListGroup {
                    Button { Task { await model.signOut() } } label: { ListRow(title: "Sign out", showChevron: false) }.buttonStyle(.plain)
                    Button { confirmDelete = true } label: {
                        ListRow(title: deleting ? "Deleting…" : "Delete account", titleColor: FC.red, showChevron: false, isLast: true)
                    }
                    .buttonStyle(.plain)
                    .disabled(deleting)
                }
                .padding(.top, 10)
                Text("Deleting your account cancels any membership billing and permanently removes your profile, bookings and training history.")
                    .font(.footnote).foregroundStyle(FC.label2).padding(.horizontal, 16)
            }
            .padding(16)
        }
        .screenBackground()
        .fcNavigation(title: "Settings")
        .onAppear(perform: fill)
        .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete everything", role: .destructive) { Task { await deleteAccount() } }
            Button("Keep my account", role: .cancel) {}
        } message: {
            Text("This cannot be undone. Your training history and records will be erased.")
        }
    }

    private func fill() {
        guard let profile = model.profile, fullName.isEmpty else { return }
        fullName = profile.fullName
        phone = profile.phone ?? ""
        units = profile.loadUnit
        emergencyName = profile.emergencyContactName ?? ""
        emergencyPhone = profile.emergencyContactPhone ?? ""
    }

    private func save() async {
        guard let userID = model.backend.currentUserID else { return }
        saving = true
        error = nil
        message = nil
        defer { saving = false }
        let blankToNil = { (text: String) -> String? in
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            return trimmed.isEmpty ? nil : trimmed
        }
        do {
            try await model.backend.updateProfile(userID: userID, .init(
                fullName: fullName.trimmingCharacters(in: .whitespaces), phone: blankToNil(phone), units: units.rawValue,
                emergencyContactName: blankToNil(emergencyName), emergencyContactPhone: blankToNil(emergencyPhone)
            ))
            await model.refreshAccount()
            message = "Saved."
        } catch {
            self.error = Backend.message(for: error)
        }
    }

    private func deleteAccount() async {
        deleting = true
        error = nil
        defer { deleting = false }
        do {
            try await model.backend.deleteAccount()
        } catch {
            self.error = Backend.message(for: error)
        }
    }
}
