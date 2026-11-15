import Foundation

/// 產生 `card.patch` 用的統一 diff（unified）。
///
/// 主機的套用器以 `\n` 切行、再以 `\n` 接回，所以這裡用同一種切法，連空字串與
/// 檔尾換行都保持一致。一次編輯只產生一個 hunk，涵蓋第一個到最後一個變動，
/// 前後各留 `contextLines` 行。
public enum UnifiedDiff {
    /// 產生 `original` 變成 `updated` 的統一 diff；兩者相同時回空字串。
    public static func make(
        original: String,
        updated: String,
        contextLines: Int = 3
    ) -> String {
        guard original != updated else { return "" }

        let oldLines = original.components(separatedBy: "\n")
        let newLines = updated.components(separatedBy: "\n")
        let context = max(0, contextLines)

        var prefix = 0
        while prefix < oldLines.count, prefix < newLines.count,
            oldLines[prefix] == newLines[prefix]
        {
            prefix += 1
        }

        var suffix = 0
        while suffix < oldLines.count - prefix, suffix < newLines.count - prefix,
            oldLines[oldLines.count - 1 - suffix] == newLines[newLines.count - 1 - suffix]
        {
            suffix += 1
        }

        let trailingContext = min(context, suffix)
        let oldStart = max(0, prefix - context)
        let newStart = oldStart
        let oldEnd = oldLines.count - suffix + trailingContext
        let newEnd = newLines.count - suffix + trailingContext

        let oldChanged = oldLines[prefix..<(oldLines.count - suffix)]
        let newChanged = newLines[prefix..<(newLines.count - suffix)]

        var lines: [String] = []
        for index in oldStart..<prefix {
            lines.append(" " + oldLines[index])
        }
        for line in oldChanged {
            lines.append("-" + line)
        }
        for line in newChanged {
            lines.append("+" + line)
        }
        for index in (oldLines.count - suffix)..<oldEnd {
            lines.append(" " + oldLines[index])
        }

        let header = "@@ -\(oldStart + 1),\(oldEnd - oldStart) +\(newStart + 1),\(newEnd - newStart) @@"
        return ([header] + lines).joined(separator: "\n")
    }
}
