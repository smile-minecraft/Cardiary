import AppKit
import CardiaryShellCore

/// 一個簡單的資訊視窗：「資料不可用」、非 APFS 警告與錯誤訊息共用。
@MainActor
final class InfoWindowController: NSWindowController {
    private var primaryAction: (() -> Void)?
    private var secondaryAction: (() -> Void)?

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 240),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.center()
        window.title = L10n.text(.unavailableTitle)
        super.init(window: window)
    }

    required init?(coder: NSCoder) {
        fatalError("不接受從 nib 載入")
    }

    func present(
        title: String,
        body: String,
        primaryTitle: String?,
        primaryAction: (() -> Void)?,
        secondaryTitle: String?,
        secondaryAction: (() -> Void)?
    ) {
        guard let window else { return }
        window.title = title
        self.primaryAction = primaryAction
        self.secondaryAction = secondaryAction

        let container = NSView(frame: window.contentLayoutRect)
        container.translatesAutoresizingMaskIntoConstraints = false
        window.contentView = container

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = NSFont.preferredFont(forTextStyle: .headline)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(titleLabel)

        let bodyLabel = NSTextField(wrappingLabelWithString: body)
        bodyLabel.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(bodyLabel)

        var constraints: [NSLayoutConstraint] = [
            titleLabel.topAnchor.constraint(equalTo: container.topAnchor, constant: 24),
            titleLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            titleLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
            bodyLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
            bodyLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            bodyLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
        ]

        var previousAnchor = bodyLabel.bottomAnchor
        if let primaryTitle {
            let button = NSButton(title: primaryTitle, target: self, action: #selector(primaryTapped))
            button.bezelStyle = .rounded
            button.keyEquivalent = "\r"
            button.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(button)
            constraints.append(contentsOf: [
                button.topAnchor.constraint(greaterThanOrEqualTo: previousAnchor, constant: 20),
                button.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
                button.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -20),
            ])
            previousAnchor = button.bottomAnchor
        }

        if let secondaryTitle {
            let button = NSButton(title: secondaryTitle, target: self, action: #selector(secondaryTapped))
            button.bezelStyle = .rounded
            button.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(button)
            constraints.append(contentsOf: [
                button.centerYAnchor.constraint(equalTo: container.bottomAnchor, constant: -32),
                button.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -140),
            ])
        }

        if primaryTitle == nil && secondaryTitle == nil {
            constraints.append(bodyLabel.bottomAnchor.constraint(lessThanOrEqualTo: container.bottomAnchor, constant: -20))
        }

        NSLayoutConstraint.activate(constraints)
        window.setContentSize(NSSize(width: 460, height: 240))
        showWindow(nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        _ = previousAnchor
    }

    @objc private func primaryTapped() {
        primaryAction?()
    }

    @objc private func secondaryTapped() {
        secondaryAction?()
    }
}
