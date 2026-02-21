// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "mac-tetris",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "mac-tetris", targets: ["mac-tetris"])
    ],
    targets: [
        .executableTarget(
            name: "mac-tetris"
        )
    ]
)
