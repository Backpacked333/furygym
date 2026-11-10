import SafariServices
import SwiftUI

/// The system in-app browser, used for Stripe Checkout and the billing portal. Card details are
/// entered on Stripe's page and never pass through the app.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .close
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
