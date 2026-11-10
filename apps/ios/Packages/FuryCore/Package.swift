// swift-tools-version: 5.9
import PackageDescription

// Models and rules shared by every screen of the Fury Co. app. Foundation only, so the same
// tests run on Linux in CI and on macOS.
let package = Package(
    name: "FuryCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "FuryCore", targets: ["FuryCore"])],
    targets: [
        .target(name: "FuryCore"),
        .testTarget(name: "FuryCoreTests", dependencies: ["FuryCore"], resources: [.copy("Fixtures")]),
    ]
)
