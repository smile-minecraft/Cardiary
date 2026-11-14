import Foundation

/// 一個串流的補送游標：記住該串流所屬的 epoch 與最後套用的耐久序號。
///
/// 規則來自 `docs/design/protocol.md` 第 6 節：序號只在同一個 epoch 內有意義；
/// 非耐久事件（`stream.text_delta`）不佔序號，也不能寫進 `lastSeq`。
public struct StreamCursor: Equatable, Sendable {
    public let stream: String
    public private(set) var epoch: String?
    public private(set) var lastSeq: Int

    public init(stream: String, epoch: String? = nil, lastSeq: Int = 0) {
        self.stream = stream
        self.epoch = epoch
        self.lastSeq = max(0, lastSeq)
    }

    /// 訂閱時要帶的參數。只有已記錄的 epoch 與主機目前 epoch 相同時才帶 `lastSeq`；
    /// 不同就要求完整快照，不帶 `lastSeq`。
    public func subscriptionParameters(currentEpoch: String) -> (lastSeq: Int?, epoch: String?) {
        guard epoch == currentEpoch, lastSeq > 0 else { return (nil, nil) }
        return (lastSeq, currentEpoch)
    }

    public enum Advance: Equatable, Sendable {
        /// 序號連續，可以套用。
        case applied(Int)
        /// 已套用過或更舊的事件，忽略。
        case duplicate(Int)
        /// 中間有缺口：要求重新載入快照，不要套用。
        case gap(expected: Int, received: Int)
        /// epoch 不同：舊的 `lastSeq` 一律無效。
        case epochChanged
    }

    public mutating func adopt(epoch: String, seq: Int) {
        self.epoch = epoch
        self.lastSeq = max(0, seq)
    }

    /// 只換 epoch，不動 `lastSeq`（用於同 epoch、無快照的補送）。
    public mutating func adoptEpochOnly(_ epoch: String) {
        self.epoch = epoch
    }

    /// 套用一則耐久事件的序號。`applied` 之後呼叫端才能把內容寫進狀態。
    public mutating func advance(to seq: Int, epoch: String) -> Advance {
        guard self.epoch == epoch else {
            return .epochChanged
        }
        if seq <= lastSeq {
            return .duplicate(seq)
        }
        if seq > lastSeq + 1 {
            return .gap(expected: lastSeq + 1, received: seq)
        }
        lastSeq = seq
        return .applied(seq)
    }
}

/// `system` 串流的本地狀態。
public struct SystemStatusModel: Equatable, Sendable {
    public private(set) var status: SystemStatus?
    public private(set) var cursor: StreamCursor

    public init(epoch: String? = nil, lastSeq: Int = 0) {
        self.cursor = StreamCursor(stream: "system", epoch: epoch, lastSeq: lastSeq)
    }

    /// 套用訂閱回應的快照。`seq` 是快照邊界，之後只接受更大的序號。
    public mutating func applySnapshot(
        _ snapshot: SystemStatus?,
        epoch: String,
        seq: Int
    ) {
        cursor.adopt(epoch: epoch, seq: seq)
        if let snapshot {
            status = snapshot
        }
    }

    /// 只記錄 epoch，保留既有的 `lastSeq`。
    ///
    /// 用在「同一個 epoch 且主機沒有回快照」的補送：回應的 `seq` 是補送開始前的
    /// 邊界，接下來會送 `lastSeq + 1` 到 `seq` 的事件。若在這裡採納 `seq`，補送的
    /// 事件全部會被當成重複而丟掉。
    public mutating func adoptEpochOnly(_ epoch: String) {
        cursor.adoptEpochOnly(epoch)
    }

    /// 事件信封本身不帶 epoch，所以游標必須先由握手或訂閱回應建立；
    /// 還沒有 epoch 時回 `.epochChanged`，由呼叫端重新訂閱。
    @discardableResult
    public mutating func apply(_ event: SystemStatusEvent) -> StreamCursor.Advance {
        guard let epoch = cursor.epoch else { return .epochChanged }
        let advance = cursor.advance(to: event.seq, epoch: epoch)
        if case .applied = advance {
            status = event.payload
        }
        return advance
    }
}
