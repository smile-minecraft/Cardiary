import CardiaryKit
@testable import CardiaryApp

extension CardService {
    func listCardPatches(cardId: String) async throws -> CardPatchesListResponsePayload {
        CardPatchesListResponsePayload(patches: [])
    }
    func acceptCardPatch(patchId: String, clientRequestId: String) async throws -> CardPatchAcceptResponsePayload {
        throw CardiaryClientError.connectionClosed
    }
    func rejectCardPatch(patchId: String, clientRequestId: String) async throws -> CardPatchRejectResponsePayload {
        throw CardiaryClientError.connectionClosed
    }
    func listCardVersions(cardId: String) async throws -> CardVersionsListResponsePayload {
        CardVersionsListResponsePayload(versions: [])
    }
    func getCardVersion(cardId: String, versionId: String) async throws -> CardVersionGetResponsePayload {
        throw CardiaryClientError.connectionClosed
    }
    func restoreCardVersion(cardId: String, versionId: String, baseRevision: String, clientRequestId: String) async throws -> CardVersionRestoreResponsePayload {
        throw CardiaryClientError.connectionClosed
    }
}
