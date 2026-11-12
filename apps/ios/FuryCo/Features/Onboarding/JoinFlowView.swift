import FuryCore
import SwiftUI

/// Facility signup: choose a membership, sign the agreement, pay, and land on a confirmation that
/// leads straight to a first booking.
struct JoinFlowView: View {
    private enum Step: Int { case plan, agreement, checkout, done }

    @Environment(AppModel.self) private var model
    @State private var step: Step = .plan
    @State private var plans: [MembershipPlan] = []
    @State private var selected: MembershipPlan?
    @State private var loadError: String?

    var body: some View {
        VStack(spacing: 0) {
            if step != .done {
                HStack {
                    GlassIconButton(systemName: step == .plan ? "xmark" : "chevron.left", label: step == .plan ? "Close" : "Back") {
                        if let previous = Step(rawValue: step.rawValue - 1) { step = previous } else { model.flow = nil }
                    }
                    Spacer()
                    StepDots(current: step.rawValue, total: 4)
                }
                .padding(.horizontal, 16)
                .frame(height: 54)
            }
            switch step {
            case .plan: planStep
            case .agreement: AgreementStep { step = .checkout }
            case .checkout: checkoutStep
            case .done: ConfirmationStep(planName: selected?.name)
            }
        }
        .background(FC.bg.ignoresSafeArea())
        .task { await load() }
        // Stripe confirms the payment a moment after the athlete returns; move on when access arrives.
        .onChange(of: model.entitlements.hasFacilityAccess) { _, hasAccess in
            if hasAccess && step == .checkout { step = .done }
        }
    }

    private func load() async {
        do {
            plans = try await model.backend.plans()
            // New members start on the intro offer when there is one.
            selected = plans.first { $0.kind == .intro } ?? plans.first
        } catch {
            loadError = Backend.message(for: error)
        }
    }

    private var planStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                ScreenHeader(eyebrow: model.gym?.name, title: "Choose a membership").padding(.bottom, 4)
                ErrorText(message: loadError)
                ForEach(plans) { plan in
                    let isSelected = selected?.id == plan.id
                    Button { selected = plan } label: {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 6) {
                                if plan.kind == .intro { Chip(text: "New member", color: FC.redFill, solid: true) }
                                Text(plan.name).font(.headline)
                                if let description = plan.description {
                                    Text(description).font(.footnote).foregroundStyle(FC.label2).multilineTextAlignment(.leading)
                                }
                            }
                            Spacer(minLength: 8)
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(Format.money(cents: plan.priceCents, currency: plan.currency).replacingOccurrences(of: ".00", with: ""))
                                    .font(FC.metric(22))
                                Text(cadence(plan)).font(.caption).foregroundStyle(FC.label2)
                            }
                            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 24))
                                .foregroundStyle(isSelected ? FC.red : FC.label3)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(isSelected ? FC.red.opacity(0.16) : FC.bg2, in: RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: FC.cardRadius, style: .continuous).stroke(isSelected ? FC.red : .clear, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .bottomBar {
            Button("Continue") { step = model.needsWaiver ? .agreement : .checkout }
                .buttonStyle(.fcFilled)
                .disabled(selected == nil)
        }
    }

    private func cadence(_ plan: MembershipPlan) -> String {
        switch plan.kind {
        case .recurring: return "per \(plan.billingInterval ?? "month")"
        case .classPack: return "pack"
        case .dropIn: return "class"
        default: return "one-time"
        }
    }

    @State private var paying = false
    @State private var payError: String?

    private var checkoutStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader(eyebrow: "Step 3 of 4", title: "Checkout")
                if let plan = selected {
                    FCard {
                        HStack {
                            Text(plan.name)
                            Spacer()
                            Text(Format.money(cents: plan.priceCents, currency: plan.currency)).monospacedDigit()
                        }
                        HStack {
                            Text("Sales tax").foregroundStyle(FC.label2)
                            Spacer()
                            Text("At payment").foregroundStyle(FC.label2)
                        }
                        FC.separator.frame(height: 0.5)
                        HStack {
                            Text("Due today").fontWeight(.semibold)
                            Spacer()
                            Text(Format.money(cents: plan.priceCents, currency: plan.currency)).fontWeight(.semibold).monospacedDigit()
                        }
                    }
                    Label(
                        plan.kind == .recurring
                            ? "Renews every \(plan.billingInterval ?? "month") until you cancel. Change or cancel any time in Profile."
                            : "One-time payment. Nothing renews automatically.",
                        systemImage: plan.kind == .recurring ? "arrow.triangle.2.circlepath" : "checkmark.shield"
                    )
                    .font(.footnote)
                    .foregroundStyle(FC.label2)
                    Label("Payment is taken securely by Stripe. Apple Pay and cards are accepted on the next screen.", systemImage: "lock.fill")
                        .font(.footnote)
                        .foregroundStyle(FC.label2)
                }
                ErrorText(message: payError)
                if model.entitlements.hasFacilityAccess == false && paying == false && payError == nil {
                    Text("Already paid? This screen moves on by itself once the payment is confirmed.")
                        .font(.caption).foregroundStyle(FC.label3)
                }
            }
            .padding(.horizontal, 16)
        }
        .bottomBar {
            Button(paying ? "Opening payment…" : "Continue to payment") { Task { await pay() } }
                .buttonStyle(.fcFilled)
                .disabled(paying || selected == nil)
        }
    }

    private func pay() async {
        guard let plan = selected else { return }
        paying = true
        defer { paying = false }
        payError = await model.startCheckout(.plan(plan.id))
    }
}

struct StepDots: View {
    let current: Int
    let total: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<total, id: \.self) { index in
                Capsule().fill(index <= current ? FC.red : FC.fill).frame(width: index == current ? 22 : 6, height: 6)
            }
        }
        .accessibilityLabel("Step \(current + 1) of \(total)")
    }
}

/// Read each document, then sign once with a typed name. Stored with time, IP and device.
struct AgreementStep: View {
    @Environment(AppModel.self) private var model
    let onSigned: () -> Void

    @State private var opened: Set<UUID> = []
    @State private var reading: Waiver?
    @State private var name = ""
    @State private var signing = false
    @State private var error: String?

    private var allRead: Bool { model.unsignedWaivers.allSatisfy { opened.contains($0.id) } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader(eyebrow: "Step 2 of 4", title: "Review & sign")
                ListGroup {
                    ForEach(Array(model.unsignedWaivers.enumerated()), id: \.element.id) { index, waiver in
                        Button {
                            reading = waiver
                            opened.insert(waiver.id)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: opened.contains(waiver.id) ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 22))
                                    .foregroundStyle(opened.contains(waiver.id) ? FC.green : FC.label3)
                                ListRow(title: waiver.title, subtitle: opened.contains(waiver.id) ? "v\(waiver.version) · Read" : "Required · tap to read", isLast: index == model.unsignedWaivers.count - 1)
                                    .padding(.leading, -16)
                            }
                            .padding(.leading, 16)
                        }
                        .buttonStyle(.plain)
                    }
                }
                ListHeader(text: "Signature")
                FCard {
                    TextField("Type your full legal name", text: $name)
                        .textContentType(.name)
                        .font(.title3.italic())
                    FC.separator.frame(height: 0.5)
                    Text("\(name.isEmpty ? "Your name" : name) · \(DateText.date(Date(), in: model.timeZone))")
                        .font(.footnote).foregroundStyle(FC.label2)
                }
                ErrorText(message: error)
            }
            .padding(.horizontal, 16)
        }
        .bottomBar {
            Button(signing ? "Signing…" : "Agree & sign") { Task { await sign() } }
                .buttonStyle(.fcFilled)
                .disabled(!allRead || name.trimmingCharacters(in: .whitespaces).count < 2 || signing)
            if !allRead {
                Text("Open each document to continue").font(.footnote).foregroundStyle(FC.label2)
            }
        }
        .sheet(item: $reading) { waiver in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(waiver.title).font(.title2.bold())
                    Text(waiver.body).font(.subheadline).foregroundStyle(FC.label2)
                }
                .padding(24)
            }
            .presentationCornerRadius(FC.sheetRadius)
            .presentationDragIndicator(.visible)
        }
        .onAppear { if name.isEmpty { name = model.profile?.fullName ?? "" } }
    }

    private func sign() async {
        signing = true
        error = nil
        defer { signing = false }
        do {
            for waiver in model.unsignedWaivers {
                try await model.backend.sign(waiverID: waiver.id, name: name.trimmingCharacters(in: .whitespaces))
            }
            await model.refreshAccount()
            onSigned()
        } catch {
            self.error = Backend.message(for: error)
        }
    }
}

/// "You're in" — what is now active, and the next classes to book.
struct ConfirmationStep: View {
    @Environment(AppModel.self) private var model
    let planName: String?
    @State private var upcoming: [ClassSession] = []

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                HStack {
                    Spacer()
                    Button("Done") { model.flow = nil }.buttonStyle(.fc(.glass, size: .medium))
                }
                Image(systemName: "checkmark")
                    .font(.system(size: 44, weight: .bold))
                    .foregroundStyle(FC.red)
                    .frame(width: 112, height: 112)
                    .overlay(Circle().stroke(FC.red, lineWidth: 6))
                    .padding(.top, 8)
                Text("You’re in\(model.firstName.map { ", \($0)" } ?? "").").font(.title.bold())
                Text("\(planName ?? "Your membership") is active. Your receipt is on its way by email.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(FC.label2)
                HStack(spacing: 10) {
                    tile("creditcard.fill", "Membership", "Active")
                    tile("calendar.badge.checkmark", "Booking", "Unlocked")
                    tile("doc.text.fill", "Waiver", model.needsWaiver ? "To sign" : "Signed")
                }
                if !upcoming.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        GroupTitle(text: "Book your first class")
                        ListGroup {
                            ForEach(Array(upcoming.enumerated()), id: \.element.id) { index, session in
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(DateText.time(session.startsAt, in: model.timeZone)).font(.headline.monospacedDigit())
                                        Text(DateText.relativeDay(DayDate(session.startsAt, in: model.timeZone), today: model.today, in: model.timeZone))
                                            .font(.caption).foregroundStyle(FC.label2)
                                    }
                                    .frame(width: 84, alignment: .leading)
                                    Capsule().fill(Color(hex: session.trackColor)).frame(width: 3, height: 36)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(session.title).font(.headline)
                                        Text(session.coachName.map { "Coach \($0)" } ?? ClassBooking.spotsLabel(for: session)).font(.footnote).foregroundStyle(FC.label2)
                                    }
                                    Spacer()
                                    Button("Reserve") {
                                        model.tab = .classes
                                        model.flow = nil
                                    }
                                    .buttonStyle(.fc(.tinted, size: .medium))
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                                .overlay(alignment: .bottom) { if index < upcoming.count - 1 { FC.separator.frame(height: 0.5).padding(.leading, 16) } }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(16)
        }
        .task {
            let sessions = (try? await model.backend.classes(from: Date(), to: Date().addingTimeInterval(3 * 86_400))) ?? []
            upcoming = Array(sessions.filter { $0.status == "scheduled" && !$0.isFull }.prefix(3))
        }
    }

    private func tile(_ icon: String, _ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).foregroundStyle(FC.green)
            Text(label).font(.caption).foregroundStyle(FC.label2)
            Text(value).font(.headline)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FC.bg2, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
