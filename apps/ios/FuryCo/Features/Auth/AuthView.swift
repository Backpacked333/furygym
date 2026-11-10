import SwiftUI

struct AuthView: View {
    private enum Mode: String, CaseIterable {
        case signIn = "Sign in"
        case signUp = "Create account"
    }

    @Environment(AppModel.self) private var model
    @State private var mode: Mode = .signIn
    @State private var fullName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?

    private var canSubmit: Bool {
        let hasEmail = email.contains("@")
        return mode == .signIn ? hasEmail && !password.isEmpty : hasEmail && password.count >= 8 && fullName.trimmingCharacters(in: .whitespaces).count >= 2
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("FURY CO. ATHLETICS").font(.caption.weight(.bold)).tracking(2).foregroundStyle(Theme.accent)
                    Text(mode == .signIn ? "Welcome back" : "Join Fury Co.").font(.largeTitle.bold())
                    Text("Your training, classes and progress in one place.").foregroundStyle(Theme.muted)
                }
                .padding(.top, 48)

                Picker("Mode", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)

                VStack(spacing: 12) {
                    if mode == .signUp {
                        TextField("Full name", text: $fullName)
                            .textContentType(.name)
                            .authField()
                    }
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .authField()
                    SecureField(mode == .signUp ? "Password (8+ characters)" : "Password", text: $password)
                        .textContentType(mode == .signUp ? .newPassword : .password)
                        .authField()
                }

                ErrorText(message: error)
                if let notice {
                    Text(notice).font(.footnote).foregroundStyle(Theme.good)
                }

                Button(mode.rawValue) { Task { await submit() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!canSubmit || busy)

                if mode == .signIn {
                    Button("Forgot password?") { Task { await reset() } }
                        .font(.footnote)
                        .disabled(!email.contains("@") || busy)
                }
            }
            .padding(24)
        }
        .background(Theme.background.ignoresSafeArea())
        .onChange(of: mode) { error = nil }
    }

    private func submit() async {
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            let address = email.trimmingCharacters(in: .whitespaces)
            switch mode {
            case .signIn:
                try await model.backend.signIn(email: address, password: password)
            case .signUp:
                let needsConfirmation = try await model.backend.signUp(fullName: fullName.trimmingCharacters(in: .whitespaces), email: address, password: password)
                if needsConfirmation {
                    notice = "Check your email to confirm your address, then sign in."
                    mode = .signIn
                }
            }
        } catch {
            self.error = mode == .signIn ? "That email and password do not match an account." : Backend.message(for: error)
        }
    }

    private func reset() async {
        busy = true
        defer { busy = false }
        try? await model.backend.sendPasswordReset(email: email.trimmingCharacters(in: .whitespaces))
        // Same answer whether or not the account exists.
        notice = "If that email has an account, a reset link is on its way."
    }
}

private extension View {
    func authField() -> some View {
        padding(14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
    }
}
