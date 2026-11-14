// swift-tools-version: 6.0

import PackageDescription

// 使用 Swift 5 語言模式：殼是 AppKit 應用，狀態由主執行緒與一條序列佇列保護，
// 不需要為了 `Process`、`NSWorkspace` 這些非 Sendable 的 AppKit 型別全面改寫。
// 需要跨執行緒傳遞的型別另外標成 `Sendable`。
let package = Package(
    name: "CardiaryShell",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "CardiaryShellCore", targets: ["CardiaryShellCore"]),
        .executable(name: "CardiaryShell", targets: ["CardiaryShell"]),
    ],
    dependencies: [
        // 客戶端連線層與產生的協定型別。
        .package(path: "../../apple/CardiaryKit"),
    ],
    targets: [
        .target(
            name: "CardiaryShellCore",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "CardiaryShell",
            dependencies: [
                "CardiaryShellCore",
                .product(name: "CardiaryKit", package: "CardiaryKit"),
            ],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // 測試用的服務替身：實作控制面的服務端，讓殼端測試有真的子行程可監管。
        // 這個執行檔不會打進 App bundle。
        .executableTarget(
            name: "CardiaryServiceDouble",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "CardiaryShellCoreTests",
            dependencies: ["CardiaryShellCore"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
