import FuryCore
import SwiftUI

/// Screens reachable from the Account tab and from prompts elsewhere in the app.
enum AccountRoute: Hashable {
    case membership
    case programs
    case waiver
    case profile
    case payments

    @ViewBuilder var destination: some View {
        switch self {
        case .membership: MembershipView()
        case .programs: ProgramsView()
        case .waiver: WaiverView()
        case .profile: ProfileEditView()
        case .payments: PaymentsView()
        }
    }
}

struct AccountView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(model.profile?.fullName.isEmpty == false ? model.profile!.fullName : "Your account").font(.title3.bold())
                        if let email = model.profile?.email { Text(email).font(.subheadline).foregroundStyle(Theme.muted) }
                        Text(model.gym?.name ?? "").font(.caption).foregroundStyle(Theme.accent)
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    row("Membership", icon: "creditcard", detail: model.entitlements.headline, route: .membership)
                    row("Online programs", icon: "figure.run", route: .programs)
                    row("Waiver", icon: "signature", detail: model.needsWaiver ? "Signature needed" : "Signed", warn: model.needsWaiver, route: .waiver)
                }

                Section {
                    row("Profile & units", icon: "person", route: .profile)
                    row("Purchases", icon: "list.bullet.rectangle", route: .payments)
                }

                Section {
                    Button("Sign out") { Task { await model.signOut() } }
                    Button(deleting ? "Deleting…" : "Delete account", role: .destructive) { confirmDelete = true }
                        .disabled(deleting)
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        ErrorText(message: error)
                        Text("Deleting your account cancels any membership billing and permanently removes your profile, bookings and training history.")
                    }
                }
            }
            .screenBackground()
            .navigationTitle("Account")
            .navigationDestination(for: AccountRoute.self) { $0.destination }
            .refreshable { await model.refreshAccount() }
            .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete everything", role: .destructive) { Task { await deleteAccount() } }
                Button("Keep my account", role: .cancel) {}
            } message: {
                Text("This cannot be undone. Your training history and records will be erased.")
            }
        }
    }

    private func row(_ title: String, icon: String, detail: String? = nil, warn: Bool = false, route: AccountRoute) -> some View {
        NavigationLink(value: route) {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                if let detail { Text(detail).font(.footnote).foregroundStyle(warn ? Theme.warn : Theme.muted).lineLimit(1) }
            }
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

/// Membership status, the plans on sale, and billing management.
struct MembershipView: View {
    @Environment(AppModel.self) private var model
    @State private var working: UUID?
    @State private var openingPortal = false
    @State private var error: String?

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: { try await model.backend.plans() }) { plans in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    current
                    ErrorText(message: error)

                    if model.needsWaiver {
                        Card {
                            Text("Sign the waiver first").font(.headline)
                            Text("It is required before buying a membership.").font(.footnote).foregroundStyle(Theme.muted)
                            NavigationLink("Read and sign", value: AccountRoute.waiver).buttonStyle(SecondaryButtonStyle())
                        }
                    } else {
                        let hasRecurring = model.memberships.contains { ($0.status == .active || $0.status == .pastDue || $0.status == .frozen) && $0.membershipPlans?.kind == .recurring }
                        SectionLabel(text: "Plans")
                        ForEach(plans.filter { !(hasRecurring && $0.kind == .recurring) }) { plan in
                            Card {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(plan.name).font(.headline)
                                    Spacer()
                                    Text(plan.priceLabel).font(.headline.monospacedDigit())
                                }
                                if let description = plan.description { Text(description).font(.footnote).foregroundStyle(Theme.muted) }
                                Button(working == plan.id ? "Opening checkout…" : "Choose") { Task { await buy(plan) } }
                                    .buttonStyle(SecondaryButtonStyle())
                                    .disabled(working != nil)
                            }
                        }
                        Text("Payment is taken securely by Stripe. Memberships are for training at the gym in person.")
                            .font(.caption).foregroundStyle(Theme.muted)
                    }
                }
                .padding(16)
            }
            .screenBackground()
        }
        .navigationTitle("Membership")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private var current: some View {
        let live = model.memberships.filter { [.active, .pastDue, .frozen].contains($0.status) }
        if live.isEmpty {
            Card {
                Text("No active membership").font(.headline)
                Text("Choose a plan below to book classes and see the gym's daily programming.").font(.footnote).foregroundStyle(Theme.muted)
            }
        } else {
            ForEach(live) { membership in
                Card {
                    HStack {
                        Text(membership.planName).font(.headline)
                        Spacer()
                        Pill(text: label(membership.status), color: membership.status == .active ? Theme.good : Theme.warn)
                    }
                    if let credits = membership.creditsRemaining {
                        Text(credits == 1 ? "1 class left" : "\(credits) classes left").font(.subheadline)
                    }
                    if membership.cancelAtPeriodEnd, let ends = membership.endsAt {
                        Text("Ends \(DateText.date(ends, in: model.timeZone))").font(.footnote).foregroundStyle(Theme.muted)
                    } else if let renews = membership.currentPeriodEnd {
                        Text("Renews \(DateText.date(renews, in: model.timeZone))").font(.footnote).foregroundStyle(Theme.muted)
                    } else if let ends = membership.endsAt {
                        Text("Valid until \(DateText.date(ends, in: model.timeZone))").font(.footnote).foregroundStyle(Theme.muted)
                    }
                    if let until = membership.frozenUntil {
                        Text("Frozen until \(DateText.day(until, in: model.timeZone))").font(.footnote).foregroundStyle(Theme.muted)
                    }
                }
            }
            Button(openingPortal ? "Opening…" : "Manage billing") { Task { await openPortal() } }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(openingPortal)
        }
    }

    private func label(_ status: MembershipStatus) -> String {
        switch status {
        case .active: return "Active"
        case .pastDue: return "Past due"
        case .frozen: return "Frozen"
        case .cancelled: return "Cancelled"
        case .expired: return "Expired"
        case .unknown: return "—"
        }
    }

    private func buy(_ plan: MembershipPlan) async {
        working = plan.id
        defer { working = nil }
        error = await model.startCheckout(.plan(plan.id))
    }

    private func openPortal() async {
        openingPortal = true
        defer { openingPortal = false }
        error = await model.openBillingPortal()
    }
}

/// Programs the athlete owns, and (where permitted) a link to buy others on the web.
struct ProgramsView: View {
    private struct Snapshot {
        var enrollments: [Enrollment]
        var catalogue: [Program]
    }

    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var editing: Enrollment?

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: load) { snapshot in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    SectionLabel(text: "Your programs")
                    if snapshot.enrollments.isEmpty {
                        Card { Text("You are not enrolled in a program.").font(.subheadline).foregroundStyle(Theme.muted) }
                    }
                    ForEach(snapshot.enrollments) { enrollment in enrollmentCard(enrollment) }

                    let owned = Set(snapshot.enrollments.filter { $0.status == .active }.map(\.programId))
                    let others = snapshot.catalogue.filter { !owned.contains($0.id) }
                    // Digital programs are sold on the web. The link is shown only where the
                    // App Store allows it (US storefront) and the gym has it switched on.
                    if model.showsProgramPurchaseLink, !others.isEmpty {
                        SectionLabel(text: "More from Fury Co.")
                        ForEach(others) { program in
                            Card {
                                Text(program.name).font(.headline)
                                if let summary = program.summary { Text(summary).font(.footnote).foregroundStyle(Theme.muted) }
                                Text("\(program.durationWeeks) weeks · \(program.daysPerWeek) sessions a week").font(.caption).foregroundStyle(Theme.muted)
                                Button {
                                    openURL(model.backend.programPageURL(slug: program.slug))
                                } label: {
                                    Label("View on furyco website", systemImage: "arrow.up.right.square")
                                }
                                .buttonStyle(SecondaryButtonStyle())
                            }
                        }
                    }
                }
                .padding(16)
            }
            .screenBackground()
        }
        .navigationTitle("Online programs")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { StartDateSheet(enrollment: $0) }
    }

    private func load() async throws -> Snapshot {
        async let enrollments = model.backend.enrollments()
        async let catalogue = model.backend.programs()
        return Snapshot(enrollments: try await enrollments, catalogue: try await catalogue)
    }

    private func enrollmentCard(_ enrollment: Enrollment) -> some View {
        let weeks = enrollment.programs?.durationWeeks ?? 0
        let phase = ProgramSchedule.phase(start: enrollment.startDate, expiresAt: enrollment.expiresAt, durationWeeks: weeks, today: model.today)
        return Card {
            Text(enrollment.programs?.name ?? "Program").font(.headline)
            if enrollment.status != .active {
                Pill(text: enrollment.status.rawValue.capitalized)
            } else {
                switch phase {
                case .upcoming(let days):
                    Text("Starts \(DateText.day(enrollment.startDate, in: model.timeZone)) — in \(days) day\(days == 1 ? "" : "s")").font(.subheadline)
                    Button("Change start date") { editing = enrollment }.buttonStyle(SecondaryButtonStyle())
                case .inProgress(let week, let total):
                    Text("Week \(week) of \(total)").font(.subheadline)
                    ProgressView(value: Double(week), total: Double(max(total, 1))).tint(Theme.accent)
                case .finished(let left):
                    Text("Complete. \(left) day\(left == 1 ? "" : "s") of access left.").font(.subheadline)
                case .expired:
                    Text("Access ended \(enrollment.expiresAt.map { DateText.day($0, in: model.timeZone) } ?? "")").font(.subheadline).foregroundStyle(Theme.muted)
                }
            }
            if let expires = enrollment.expiresAt, enrollment.status == .active, phase != .expired {
                Text("Access until \(DateText.day(expires, in: model.timeZone))").font(.caption).foregroundStyle(Theme.muted)
            }
        }
    }
}

private struct StartDateSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let enrollment: Enrollment
    @State private var date = Date()
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Start date", selection: $date, in: Date()...Date().addingTimeInterval(90 * 86_400), displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .environment(\.timeZone, model.timeZone)
                } footer: {
                    Text("Day 1 of your calendar. The whole program moves with it.")
                }
                if let error { Section { ErrorText(message: error) } }
            }
            .navigationTitle("Start date")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(saving) }
            }
            .onAppear { date = enrollment.startDate.noon(in: model.timeZone) }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await model.backend.setStartDate(enrollmentID: enrollment.id, to: DayDate(date, in: model.timeZone))
            model.didChange()
            dismiss()
        } catch {
            self.error = Backend.message(for: error)
        }
    }
}
