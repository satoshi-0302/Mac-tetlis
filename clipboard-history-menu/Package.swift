// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "clipboard-history-menu",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "clipboard-history-menu"
        )
    ]
)
