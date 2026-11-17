import CardiaryKit
import XCTest

@testable import CardiaryApp

/// MCP 分頁：清單、新增送審批、移除、啟停、允許網域與事件更新。
///
/// 這裡斷言介面字串，固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class McpSettingsModelTests: XCTestCase {
    private func makeModel() -> McpSettingsModel {
        McpSettingsModel(language: .zhHant)
    }

    private func server(
        _ id: String = "srv-1",
        name: String = "Filesystem",
        transport: McpTransport = .stdio,
        url: String? = nil,
        allowedHosts: [String] = [],
        enabled: Bool = true,
        state: McpServerState = .ready,
        failure: String? = nil
    ) -> McpServerInfo {
        McpServerInfo(
            serverId: id,
            name: name,
            transport: transport,
            command: transport == .stdio ? "npx" : nil,
            args: transport == .stdio ? ["server"] : nil,
            url: url,
            allowedHosts: allowedHosts,
            enabled: enabled,
            state: state,
            failure: failure,
            createdAt: "2026-01-01T00:00:00Z"
        )
    }

    func testLoadListsServersAndTheirState() async {
        let model = makeModel()
        model.attach(service: FakeCardiaryService(mcpServers: [
            server("a", name: "Filesystem"),
            server("b", name: "Fetch", transport: .http, url: "https://api.example.com/mcp",
                   enabled: false, state: .disabled),
            server("c", name: "Broken", state: .failed, failure: "連線中斷"),
        ]))

        await model.load()

        XCTAssertFalse(model.isLoading)
        XCTAssertEqual(model.servers.map(\.serverId), ["a", "b", "c"])
        XCTAssertEqual(McpSettingsModel.stateKey(.failed), .mcpStateFailed)
        XCTAssertEqual(model.servers.last?.failure, "連線中斷")
        XCTAssertNil(model.errorMessage)
    }

    func testAddStdioWaitsForApprovalAndShowsNewServer() async {
        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)

        let accepted = await model.add(
            name: "  Filesystem  ",
            transport: .stdio,
            command: " npx ",
            arguments: "\"-y\" --verbose 'a b'"
        )

        XCTAssertTrue(accepted)
        let add = await fake.mcpAdds.first
        XCTAssertEqual(add?.name, "Filesystem")
        XCTAssertEqual(add?.command, "npx")
        XCTAssertEqual(add?.args, ["-y", "--verbose", "a b"])
        XCTAssertEqual(add?.allowedHosts, [], "stdio 伺服器不能帶允許網域")
        XCTAssertTrue(model.awaitingApproval)
        XCTAssertEqual(model.pendingApprovalId, "approval-mcp")
        XCTAssertEqual(model.noticeMessage, "已送出審批。批准之後才會啟動伺服器。")
        XCTAssertTrue(model.servers.isEmpty, "審批前不該出現在清單")

        let approved = server("new", name: "Filesystem")
        await fake.emitMcpServersChanged(McpServersChangedEventPayload(server: approved, removed: false))
        try? await waitUntil { !model.awaitingApproval }

        XCTAssertEqual(model.servers.map(\.serverId), ["new"])
        XCTAssertFalse(model.awaitingApproval)
        XCTAssertNil(model.pendingApprovalId)
        XCTAssertEqual(model.noticeMessage, "伺服器已加入。")
    }

    func testOtherServerEventDoesNotEndApprovalWait() async {
        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)

        _ = await model.add(name: "Filesystem", transport: .stdio, command: "npx")
        await fake.emitMcpServersChanged(McpServersChangedEventPayload(
            server: server("other", name: "Fetch"), removed: false
        ))
        try? await waitUntil { model.servers.map(\.name) == ["Fetch"] }

        XCTAssertTrue(model.awaitingApproval, "別台伺服器的事件不該結束等待")
        XCTAssertEqual(model.noticeMessage, "已送出審批。批准之後才會啟動伺服器。")

        await fake.emitMcpServersChanged(McpServersChangedEventPayload(
            server: server("new", name: "Filesystem"), removed: false
        ))
        try? await waitUntil { !model.awaitingApproval }
        XCTAssertFalse(model.awaitingApproval)
        XCTAssertEqual(model.servers.map(\.name), ["Fetch", "Filesystem"])
    }

    func testAddHTTPIncludesURLHostInAllowedHosts() async {
        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)

        _ = await model.add(
            name: "Fetch",
            transport: .http,
            url: "https://api.example.com:8443/mcp",
            allowedHosts: "extra.example.com, API.EXAMPLE.COM"
        )

        let add = await fake.mcpAdds.first
        XCTAssertEqual(add?.url, "https://api.example.com:8443/mcp")
        XCTAssertEqual(add?.allowedHosts, ["extra.example.com", "api.example.com"],
                       "URL 網域必須在清單裡；重複的不用再送")
        XCTAssertEqual(
            McpSettingsModel.hostsIncludingURLHost(["extra.example.com"], url: "https://API.Example.com/mcp"),
            ["extra.example.com", "api.example.com"]
        )
    }

    func testInvalidFormDoesNotSendRequest() async {
        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)

        let noCommand = await model.add(name: "Filesystem", transport: .stdio, command: "   ")
        XCTAssertFalse(noCommand)
        let noURL = await model.add(name: "Fetch", transport: .http, url: nil)
        XCTAssertFalse(noURL)
        let adds = await fake.mcpAdds
        XCTAssertTrue(adds.isEmpty)
        XCTAssertEqual(model.errorMessage, "請填寫名稱與必要的連線欄位。")
        XCTAssertFalse(model.awaitingApproval)
    }

    func testRemoveUpdatesListFromResponse() async {
        let fake = FakeCardiaryService(mcpServers: [server()])
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        await model.remove(model.servers[0])

        let removes = await fake.mcpRemoves
        XCTAssertEqual(removes, ["srv-1"])
        XCTAssertTrue(model.servers.isEmpty)
        XCTAssertEqual(model.noticeMessage, "已移除伺服器。")
    }

    func testSetEnabledUsesResponseServer() async {
        let fake = FakeCardiaryService(mcpServers: [server()])
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        await model.setEnabled(model.servers[0], enabled: false)

        let changes = await fake.mcpEnabled
        XCTAssertEqual(changes.count, 1)
        XCTAssertEqual(changes.first?.serverId, "srv-1")
        XCTAssertFalse(changes.first?.enabled ?? true)
        XCTAssertFalse(model.servers[0].enabled)
        XCTAssertEqual(model.servers[0].state, .disabled)
        XCTAssertEqual(model.noticeMessage, "已停用伺服器。")
    }

    func testAllowedHostsKeepURLHostAndReplaceServer() async {
        let original = server(
            "srv-1", transport: .http, url: "https://api.example.com/mcp",
            allowedHosts: ["api.example.com"]
        )
        let fake = FakeCardiaryService(mcpServers: [original])
        let model = makeModel()
        model.attach(service: fake)
        await model.load()

        await model.addAllowedHost("Extra.Example.com", to: model.servers[0])

        let changes = await fake.mcpAllowedHosts
        XCTAssertEqual(changes.first?.hosts, ["api.example.com", "extra.example.com"])
        XCTAssertEqual(model.servers[0].allowedHosts, ["api.example.com", "extra.example.com"])
        XCTAssertEqual(model.noticeMessage, "已更新允許的網域。")

        await model.removeAllowedHost("api.example.com", from: model.servers[0])
        let afterRemoval = await fake.mcpAllowedHosts
        XCTAssertEqual(afterRemoval.last?.hosts, ["extra.example.com", "api.example.com"],
                       "URL 網域不能被移除，否則連線會被拒絕")
    }

    func testRequestFailureShowsError() async {
        let fake = FakeCardiaryService(mcpServers: [])
        let model = makeModel()
        model.attach(service: fake)

        await model.setEnabled(server("missing"), enabled: true)

        XCTAssertTrue(model.errorMessage?.hasPrefix("MCP 請求失敗：") ?? false)
        XCTAssertNil(model.noticeMessage)
    }

    func testServiceUnavailableShowsError() async {
        let model = makeModel()
        await model.load()
        XCTAssertEqual(model.errorMessage, "還沒連上服務，MCP 設定需要連線。")

        model.dismissMessages()
        XCTAssertNil(model.errorMessage)
        let accepted = await model.add(name: "Fetch", transport: .http, url: "https://example.com/mcp")
        XCTAssertFalse(accepted)
        XCTAssertEqual(model.errorMessage, "還沒連上服務，MCP 設定需要連線。")
    }

    func testEventAfterDetachIsIgnored() async {
        let fake = FakeCardiaryService(mcpServers: [server()])
        let model = makeModel()
        model.attach(service: fake)
        try? await waitUntil { await fake.mcpServerHandlerInstalled }
        await model.load()
        model.detach()
        try? await waitUntil { await !fake.mcpServerHandlerInstalled }

        await fake.emitMcpServersChanged(McpServersChangedEventPayload(
            server: server("new"), removed: false
        ))
        try? await Task.sleep(for: .milliseconds(50))

        XCTAssertTrue(model.servers.isEmpty)
    }

    private func waitUntil(
        timeout: TimeInterval = 2,
        _ condition: () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("等待條件逾時")
    }

    private func waitUntil(
        timeout: TimeInterval = 2,
        _ condition: () async -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("等待條件逾時")
    }
}

