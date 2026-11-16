import AppKit
import CardiaryKit
import SwiftUI

/// 「匯入」選單命令與視窗。
///
/// `ImportUIModule.makeEntry` 指到 `ImportUIEntry.live`，視窗由這裡自己開；
/// `App/` 的主視窗、註冊表與模型都不用動。連線取自 `AppModel.service`，
/// 模組請求直接走 `CardiaryClient.sendModuleRequest`，沒有另一套傳輸。
extension ImportUIEntry {
    /// App 啟動時掛上的匯入入口：一個開啟匯入流程的命令。
    public static func live(_ app: AppModel) -> ImportUIEntry {
        ImportUIEntry(commands: [
            AppCommand(id: "import.open", titleKey: .commandGroupImport) {
                ImportWindow.present(app: app)
            },
        ])
    }
}

/// 匯入視窗的持有者。關閉後清掉，下次開啟用目前的連線重建流程。
@MainActor
private final class ImportWindowController: NSWindowController, NSWindowDelegate {
    var onClose: (@MainActor () -> Void)?

    func windowWillClose(_ notification: Notification) {
        onClose?()
    }
}

@MainActor
enum ImportWindow {
    private static var controller: ImportWindowController?

    static func present(app: AppModel) {
        if let controller, let window = controller.window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        guard let client = app.service as? CardiaryClient else {
            presentNeedsConnection()
            return
        }

        let model = ImportFlowModel(service: ModuleImportService(sender: client))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = ImportL10n.text(.importTitle)
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(Palette.canvas)
        window.isReleasedWhenClosed = false
        let openLibrary: (() -> Void)? = app.screen == .main
            ? { [weak window] in
                guard let window else { return }
                Task { await app.refreshContentModels() }
                app.selectSlot(AppRegistry.cardsSlotId)
                app.bridge.actions.openMainWindow()
                window.close()
            }
            : nil
        window.contentViewController = NSHostingController(rootView: ImportView(
            model: model,
            onOpenLibrary: openLibrary
        ))

        let controller = ImportWindowController(window: window)
        controller.onClose = {
            client.handlers.onModuleEvent = nil
            Self.controller = nil
        }
        window.delegate = controller
        Self.controller = controller

        // 寫入成功後卡片庫要重讀；匯入視窗關著也一樣。
        model.onWriteCompleted = {
            Task { await app.refreshContentModels() }
        }

        // 進度事件只轉給這個視窗；App 的共用事件路徑不受影響。
        client.handlers.onModuleEvent = { frame in
            guard case .moduleEvent(let event) = frame,
                event.type == "module.import.progress",
                let progress = ImportProgress(json: .object(event.payload.data))
            else { return }
            Task { @MainActor in model.apply(progress: progress) }
        }

        window.center()
        controller.showWindow(nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        Task { await model.load() }
    }

    private static func presentNeedsConnection() {
        let alert = NSAlert()
        alert.messageText = ImportL10n.text(.importNeedsConnection)
        alert.alertStyle = .warning
        alert.addButton(withTitle: AppL10n.text(.genericClose))
        alert.runModal()
    }
}

private extension ImportProgress {
    /// 模組事件的 `data` 就是進度物件；解碼失敗代表不是這個事件，直接忽略。
    init?(json: JSONValue) {
        guard let data = try? JSONEncoder().encode(json),
            let value = try? JSONDecoder().decode(ImportProgress.self, from: data)
        else { return nil }
        self = value
    }
}
