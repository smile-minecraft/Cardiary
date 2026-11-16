/**
 * 白板的領域型別。
 *
 * 白板只保存版面：卡片識別碼、座標、連線與分組。卡片本體在 cards/，
 * 同一張卡可以投影到多個白板，投影不是複本。
 */

/** 白板檔格式版本；未知版本拒絕讀取。 */
export type BoardSchemaVersion = 1;

export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

export interface BoardSize {
  readonly width: number;
  readonly height: number;
}

/** 一個投影實例。不同白板上的同一張卡有不同 item id。 */
export interface BoardItem {
  /** 投影的 ULID，不是卡片識別碼。 */
  readonly id: string;
  /** 卡片本體的 ULID。 */
  readonly cardId: string;
  readonly position: BoardPoint;
  readonly size: BoardSize;
  /** 任一個投影被釘選，該卡片就算釘選（新鮮度固定 100）。 */
  readonly pinned: boolean;
  readonly origin: "canvas" | "inbox";
  readonly projectedBy?: "user" | "agent" | undefined;
  readonly groupId?: string | undefined;
}

/** 白板上的顯式連線。只屬於這一份白板。 */
export interface BoardEdge {
  readonly id: string;
  /** items[].id，不是 cardId。 */
  readonly from: string;
  /** items[].id，不是 cardId。 */
  readonly to: string;
  readonly label?: string | undefined;
}

export interface BoardGroup {
  readonly id: string;
  readonly label: string;
  /** 上層分組；形成環時驗證失敗。 */
  readonly parentId?: string | undefined;
}

/** 一份白板的完整內容，等於 boards/<id>.json 的形狀。 */
export interface BoardDocument {
  readonly schema: BoardSchemaVersion;
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly BoardItem[];
  readonly inbox: readonly BoardItem[];
  readonly edges: readonly BoardEdge[];
  readonly groups: readonly BoardGroup[];
}

/** 白板列表用摘要，不含投影與連線。 */
export interface BoardSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly itemCount: number;
}

export type BoardChange = "created" | "updated" | "deleted";

/**
 * 代理的白板操作模式。
 *
 * `read_only` 是不動使用者內容：可讀被圈選卡片、可投影新卡到收件區，
 * 但不能移動、連線、分組、取消投影、釘選或刪除既有物件。
 * `full` 可新增、移動、連線、分組、移除；所有變更都要能復原。
 */
export type BoardAgentMode = "read_only" | "full";

/** 代理可能請求的白板操作，通過 isAgentBoardOperationAllowed 判定。 */
export type BoardOperation =
  | "read"
  | "create_board"
  | "project_card"
  | "create_card_from_selection"
  | "unproject_card"
  | "move_item"
  | "add_edge"
  | "remove_edge"
  | "group"
  | "pin"
  | "save"
  | "delete_board";

/** 圈選生成的新卡草稿；寫成卡片 frontmatter 時 derivedFrom 就是 sources。 */
export interface CardDraftFromSelection {
  readonly title: string;
  readonly derivedFrom: readonly string[];
}

/** 建立空白板所需的輸入；id 與時間由呼叫端提供，保持領域層純函式。 */
export interface CreateBoardInput {
  readonly id: string;
  readonly title: string;
  readonly now: string;
}
