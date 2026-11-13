// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "CardiaryKit",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "CardiaryKit", targets: ["CardiaryKit"]),
    ],
    targets: [
        .target(name: "CardiaryKit"),
        .testTarget(name: "CardiaryKitTests", dependencies: ["CardiaryKit"]),
    ]
)
