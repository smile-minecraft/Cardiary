// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ProtocolCompatibilityTests",
    platforms: [.macOS(.v14)],
    dependencies: [.package(path: "../../../apple/CardiaryKit")],
    targets: [
        .testTarget(
            name: "ProtocolCompatibilityTests",
            dependencies: [.product(name: "CardiaryKit", package: "CardiaryKit")]
        ),
    ]
)
