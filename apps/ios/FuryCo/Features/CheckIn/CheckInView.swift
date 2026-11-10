import CoreImage.CIFilterBuiltins
import CryptoKit
import FuryCore
import SwiftUI

/// The athlete's check-in code. It changes every 30 seconds, so a screenshot cannot be reused.
struct CheckInView: View {
    @Environment(AppModel.self) private var model
    @State private var secret: String?
    @State private var error: String?
    @State private var nextClass: ClassSession?

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                ScreenHeader(
                    eyebrow: nextClass.map { "\($0.title) · \(DateText.time($0.startsAt, in: model.timeZone))" } ?? model.gym?.name,
                    title: "Check in"
                )
                .padding(.top, 8)

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    VStack(spacing: 14) {
                        Group {
                            if let secret, let userID = model.backend.currentUserID,
                               let image = Self.qrImage(CheckInCode.payload(userID: userID, code: Self.code(secret: secret, at: context.date))) {
                                Image(uiImage: image).interpolation(.none).resizable().scaledToFit().padding(22)
                            } else if let error {
                                Text(error).font(.footnote).foregroundStyle(.black).multilineTextAlignment(.center).padding(24)
                            } else {
                                ProgressView().tint(.black)
                            }
                        }
                        .frame(width: 276, height: 276)
                        .background(.white, in: RoundedRectangle(cornerRadius: 36, style: .continuous))
                        .shadow(color: FC.redFill.opacity(0.35), radius: 40)
                        .accessibilityLabel("Your check-in code")

                        Text(model.profile?.fullName ?? "").font(.headline)
                        Text("Hold to the front-desk scanner · new code in \(CheckInCode.secondsRemaining(at: context.date))s")
                            .font(.footnote).foregroundStyle(FC.label2).monospacedDigit()
                    }
                }

                milestoneCard
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
        .screenBackground()
        .withTabBar()
        .toolbar(.hidden, for: .navigationBar)
        .task(id: model.revision) { await load() }
    }

    private var milestoneCard: some View {
        let milestone = model.milestone
        return FCard {
            HStack {
                Label("\(milestone.target)-class milestone", systemImage: "medal.fill").font(.headline).foregroundStyle(.white)
                Spacer()
                Text("\(milestone.visits) / \(milestone.target)").font(.subheadline.weight(.semibold)).monospacedDigit()
            }
            GeometryReader { proxy in
                Capsule().fill(FC.fill).overlay(alignment: .leading) {
                    Capsule().fill(FC.yellow).frame(width: proxy.size.width * CGFloat(Double(milestone.visits) / Double(milestone.target)))
                }
            }
            .frame(height: 6)
            Text(model.gym?.milestoneReward.map { "\(milestone.remaining) more \(milestone.remaining == 1 ? "visit" : "visits") unlocks \($0)" }
                ?? "\(milestone.remaining) more \(milestone.remaining == 1 ? "visit" : "visits") to go")
                .font(.footnote).foregroundStyle(FC.label2)
        }
    }

    private func load() async {
        do {
            if secret == nil { secret = try await model.backend.checkInSecret() }
            error = nil
        } catch {
            self.error = Backend.message(for: error)
        }
        let sessions = (try? await model.backend.classes(from: Date().addingTimeInterval(-1800), to: Date().addingTimeInterval(86_400))) ?? []
        nextClass = sessions.first { $0.myBookingStatus == .booked }
    }

    /// First ten hex characters of HMAC-SHA256(secret, counter) — the same sum the server checks.
    static func code(secret: String, at date: Date) -> String {
        let key = SymmetricKey(data: Data(secret.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data(String(CheckInCode.counter(at: date)).utf8), using: key)
        return String(mac.map { String(format: "%02x", $0) }.joined().prefix(10))
    }

    static func qrImage(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cgImage = CIContext().createCGImage(output, from: output.extent)
        else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
