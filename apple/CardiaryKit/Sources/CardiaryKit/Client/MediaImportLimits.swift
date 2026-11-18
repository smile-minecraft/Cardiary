import Foundation

/// 媒體匯入的等待上限。
///
/// 主機在 `media.import` 期間同步等殼端辨識：圖片最多 65 秒、語音最多 305 秒
/// （`packages/host/src/modules/media/recognition.ts` 的 `OCR_TIMEOUT_MS` 與
/// `TRANSCRIBE_TIMEOUT_MS`），辨識完還要寫文字替身與建卡。客戶端如果沿用
/// 一般請求的 10 秒，就會在主機仍在辨識時先判逾時，畫面顯示匯入失敗，
/// 但卡片其實已經建立。
///
/// 兩邊的一致性由 `packages/host/test/modules/media/limits.test.ts` 檢查：
/// 這裡的秒數必須大於主機最長的辨識上限加上建卡需要的餘裕。
public enum MediaImportLimits {
    /// 比主機最長的辨識上限（305 秒）多 55 秒，留給描述與建卡。
    public static let requestTimeout: Duration = .seconds(360)

    public static let requestOptions = CardiaryConnection.RequestOptions(
        timeout: requestTimeout
    )
}
