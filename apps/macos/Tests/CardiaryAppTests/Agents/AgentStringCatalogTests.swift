import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 外部代理字串：兩語都要有內容，而且核心幾個 key 的翻譯固定。
@MainActor
final class AgentStringCatalogTests: XCTestCase {
    private let agentKeys: [AppString] = [
        .inspectorAgentsTitle, .inspectorAgentsEmpty, .agentsUnavailable,
        .agentKindOpencode, .agentKindClaudeCode,
        .agentStatusStarting, .agentStatusRunning, .agentStatusWaitingApproval,
        .agentStatusStopped, .agentStatusFailed,
        .agentResultUnknown, .agentResultUnknownHelp,
        .agentWorkingDirectory, .agentPermissionTitle,
        .agentProgressStep, .agentServiceUnavailable,
        .agentStartTitle, .agentStartKind, .agentStartDirectory,
        .agentStartPrompt, .agentStartPromptPlaceholder, .agentStartAction,
        .agentStartNeedsApproval, .agentStartInvalidDirectory, .agentStartedNotice,
        .agentStopAction, .agentStoppedNotice
    ]

    func testEveryAgentKeyHasBothLanguages() {
        for key in agentKeys {
            XCTAssertFalse(AppL10n.text(key, language: .zhHant).isEmpty, "\(key.rawValue) 缺繁中")
            XCTAssertFalse(AppL10n.text(key, language: .en).isEmpty, "\(key.rawValue) 缺英文")
        }
    }

    func testKeyTranslations() {
        XCTAssertEqual(AppL10n.text(.inspectorAgentsTitle, language: .zhHant), "外部代理")
        XCTAssertEqual(AppL10n.text(.inspectorAgentsTitle, language: .en), "External Agents")
        XCTAssertEqual(AppL10n.text(.agentResultUnknown, language: .zhHant), "結果未知")
        XCTAssertEqual(AppL10n.text(.agentResultUnknown, language: .en), "Result unknown")
        XCTAssertEqual(AppL10n.text(.agentStatusWaitingApproval, language: .zhHant), "等待核准")
        XCTAssertEqual(AppL10n.text(.agentStatusWaitingApproval, language: .en), "Waiting for approval")
        XCTAssertEqual(
            AppL10n.format(.agentPermissionTitle, value: "shell", language: .en),
            "Waiting for approval: shell"
        )
        XCTAssertEqual(
            AppL10n.format(.agentProgressStep, value: "2/4", language: .zhHant),
            "進度 2/4"
        )
        XCTAssertEqual(
            AppL10n.format(.agentWorkingDirectory, value: "/tmp/work", language: .en),
            "Working directory: /tmp/work"
        )
        XCTAssertEqual(AppL10n.text(.agentStartTitle, language: .zhHant), "啟動外部代理")
        XCTAssertEqual(AppL10n.text(.agentStartTitle, language: .en), "Start an external agent")
        XCTAssertEqual(AppL10n.text(.agentStartAction, language: .zhHant), "啟動")
        XCTAssertEqual(AppL10n.text(.agentStartAction, language: .en), "Start")
        XCTAssertEqual(AppL10n.text(.agentStopAction, language: .zhHant), "停止")
        XCTAssertEqual(AppL10n.text(.agentStopAction, language: .en), "Stop")
    }

    func testKindAndStatusTextFollowLanguage() {
        let session = AgentSessionPresentation(
            info: Fixtures.agentInfo(kind: .claudeCode, status: .waitingApproval)
        )
        XCTAssertEqual(session.kindText(language: .zhHant), "Claude Code")
        XCTAssertEqual(session.statusText(language: .zhHant), "等待核准")
        XCTAssertEqual(session.statusText(language: .en), "Waiting for approval")
    }
}
