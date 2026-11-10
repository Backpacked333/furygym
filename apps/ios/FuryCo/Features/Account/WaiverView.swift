import FuryCore
import SwiftUI

/// Read and sign the gym's waiver. The signature is a typed full name, stored with the time and device.
struct WaiverView: View {
    @Environment(AppModel.self) private var model
    @State private var name = ""
    @State private var agreed = false
    @State private var signing = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let waiver = model.unsignedWaivers.first {
                    Text(waiver.title).font(.title2.bold())
                    Text(waiver.body).font(.subheadline).foregroundStyle(Theme.muted)
                    Divider().overlay(Theme.line)
                    Toggle("I have read and agree to the above", isOn: $agreed)
                    TextField("Type your full legal name", text: $name)
                        .textContentType(.name)
                        .padding(14)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
                    ErrorText(message: error)
                    Button(signing ? "Signing…" : "Sign") { Task { await sign(waiver) } }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!agreed || name.trimmingCharacters(in: .whitespaces).count < 2 || signing)
                } else {
                    ContentUnavailableView("Waiver signed", systemImage: "checkmark.seal.fill", description: Text("Nothing more to sign. You're clear to book classes."))
                        .padding(.top, 60)
                }
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("Waiver")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if name.isEmpty { name = model.profile?.fullName ?? "" } }
    }

    private func sign(_ waiver: Waiver) async {
        signing = true
        error = nil
        defer { signing = false }
        do {
            try await model.backend.sign(waiverID: waiver.id, name: name.trimmingCharacters(in: .whitespaces))
            agreed = false
            await model.refreshAccount()
            model.didChange()
        } catch {
            self.error = Backend.message(for: error)
        }
    }
}

struct ProfileEditView: View {
    @Environment(AppModel.self) private var model
    @State private var fullName = ""
    @State private var phone = ""
    @State private var units: LoadUnit = .lb
    @State private var emergencyName = ""
    @State private var emergencyPhone = ""
    @State private var saving = false
    @State private var message: String?
    @State private var error: String?

    var body: some View {
        Form {
            Section("You") {
                TextField("Full name", text: $fullName).textContentType(.name)
                TextField("Phone", text: $phone).textContentType(.telephoneNumber).keyboardType(.phonePad)
                Picker("Weights in", selection: $units) {
                    Text("Pounds (lb)").tag(LoadUnit.lb)
                    Text("Kilograms (kg)").tag(LoadUnit.kg)
                }
            }
            Section("Emergency contact") {
                TextField("Name", text: $emergencyName).textContentType(.name)
                TextField("Phone", text: $emergencyPhone).textContentType(.telephoneNumber).keyboardType(.phonePad)
            }
            Section {
                Button(saving ? "Saving…" : "Save") { Task { await save() } }
                    .disabled(saving || fullName.trimmingCharacters(in: .whitespaces).count < 2)
            } footer: {
                VStack(alignment: .leading) {
                    ErrorText(message: error)
                    if let message { Text(message).foregroundStyle(Theme.good) }
                }
            }
        }
        .screenBackground()
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: fill)
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
}

struct PaymentsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        AsyncContent(reloadKey: model.revision, load: { try await model.backend.payments() }) { payments in
            List {
                if payments.isEmpty {
                    Text("No purchases yet.").foregroundStyle(Theme.muted)
                }
                ForEach(payments) { payment in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(payment.description ?? "Payment").font(.subheadline.weight(.semibold))
                            Text(DateText.date(payment.paidAt ?? payment.createdAt, in: model.timeZone)).font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(Format.money(cents: payment.amountCents, currency: payment.currency)).font(.subheadline.monospacedDigit())
                            if payment.status != "succeeded" {
                                Text(payment.status.replacingOccurrences(of: "_", with: " ")).font(.caption).foregroundStyle(payment.status == "failed" ? Theme.warn : Theme.muted)
                            }
                        }
                    }
                }
            }
            .screenBackground()
        }
        .navigationTitle("Purchases")
        .navigationBarTitleDisplayMode(.inline)
    }
}
