import SwiftUI

/// First launch: two doors (gym membership or online training) and sign-in. Both doors create the
/// same athlete account.
struct WelcomeView: View {
    private enum Entry: String, Identifiable {
        case joinGym, trainOnline, signIn
        var id: String { rawValue }
    }

    @State private var entry: Entry?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            HeroBackdrop().ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                AppMark(size: 56)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Strength.")
                    Text("Engine.")
                    Text("Selection.").foregroundStyle(FC.red)
                }
                .font(.system(size: 44, weight: .heavy))
                .tracking(-1.2)
                Text("Memberships, classes and coach-built programming from Fury Co. Athletics — in one place.")
                    .font(.body)
                    .foregroundStyle(FC.label2)
                VStack(spacing: 12) {
                    Button("Join the gym") { entry = .joinGym }.buttonStyle(.fc(.white))
                    Button("Train online") { entry = .trainOnline }.buttonStyle(.fc(.outline))
                }
                .padding(.top, 6)
                HStack(spacing: 4) {
                    Text("Already a member?").foregroundStyle(FC.label2)
                    Button("Sign in") { entry = .signIn }.fontWeight(.semibold).foregroundStyle(.white)
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity)
            }
            .padding(24)
            .padding(.bottom, 12)
        }
        .sheet(item: $entry) { entry in
            AuthSheet(
                mode: entry == .signIn ? .signIn : .signUp,
                intent: entry == .joinGym ? .joinGym : entry == .trainOnline ? .programs : nil
            )
            .fcSheet(height: entry == .signIn ? 420 : 500)
        }
    }
}

/// Sign in or create an account.
struct AuthSheet: View {
    enum Mode { case signIn, signUp }

    @Environment(AppModel.self) private var model
    @State var mode: Mode
    let intent: AppModel.Flow?

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
        VStack(alignment: .leading, spacing: 14) {
            Text(mode == .signIn ? "Welcome back" : intent == .programs ? "Train online" : "Join Fury Co.")
                .font(.title2.bold())
                .padding(.top, 8)
            if mode == .signUp {
                FCField(placeholder: "Full name", text: $fullName, systemImage: "person").textContentType(.name)
            }
            FCField(placeholder: "Email", text: $email, systemImage: "envelope")
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            FCField(placeholder: mode == .signUp ? "Password (8+ characters)" : "Password", text: $password, systemImage: "lock", secure: true)
                .textContentType(mode == .signUp ? .newPassword : .password)

            ErrorText(message: error)
            if let notice { Text(notice).font(.footnote).foregroundStyle(FC.green) }

            Button(busy ? "One moment…" : mode == .signIn ? "Sign in" : "Create account") { Task { await submit() } }
                .buttonStyle(.fcFilled)
                .disabled(!canSubmit || busy)

            HStack {
                Button(mode == .signIn ? "Create an account" : "I already have an account") {
                    mode = mode == .signIn ? .signUp : .signIn
                    error = nil
                }
                Spacer()
                if mode == .signIn {
                    Link("Forgot password?", destination: model.backend.webBaseURL.appending(path: "reset-password").appending(queryItems: [URLQueryItem(name: "request", value: "1")]))
                }
            }
            .font(.footnote.weight(.semibold))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
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
                model.intentAfterSignIn = intent
                let needsConfirmation = try await model.backend.signUp(fullName: fullName.trimmingCharacters(in: .whitespaces), email: address, password: password)
                if needsConfirmation {
                    mode = .signIn
                    notice = "Check your email to confirm your address, then sign in."
                }
            }
        } catch {
            self.error = mode == .signIn ? Backend.signInMessage(for: error) : Backend.message(for: error)
        }
    }

}
