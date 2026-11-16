import type { JsonValue, ToolDefinition, ToolOutcome } from "@cardiary/engine-adapter";

import {
  computeFirstRun,
  parseScheduleKind,
  parseScheduleSpec,
  parseScheduleTask,
} from "@cardiary/domain";
import type { ScheduleStore } from "@cardiary/storage";

/**
 * `schedule_propose`：代理提議排程的唯一路徑。
 *
 * 工具本身**先過審批**：`schedule_propose` 沒有任何動作分類，權限閘道一律
 * 回 `ask-human`，而且不提供「一律允許」（沒有 allowlist 需要的動作分類
 * 細節）。使用者核准後才會執行到這裡；核准前排程不存在，拒絕後也不存在。
 * 代理沒有繞過審批直接建立排程的路徑——`module.scheduler.create` 是協定
 * 訊息，代理沒有協定入口。
 */
export function scheduleProposeTool(deps: {
  readonly schedules: ScheduleStore;
  readonly now: () => Date;
}): ToolDefinition {
  const { schedules, now } = deps;
  return {
    name: "schedule_propose",
    description:
      "向使用者提議建立一個排程（kind：once／daily／interval／heartbeat；spec：once 需要 at、daily 需要 time（HH:MM 本機時區）、interval／heartbeat 需要 everyMs）。需要使用者核准才會生效；核准前排程不存在。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "kind", "spec", "task"],
      properties: {
        title: {
          type: "string",
          description: "排程的名稱，顯示給使用者看。",
        },
        kind: {
          type: "string",
          enum: ["once", "daily", "interval", "heartbeat"],
          description: "排程的觸發方式。",
        },
        spec: {
          type: "object",
          description:
            "once：{at: RFC 3339}；daily：{time: HH:MM}；interval／heartbeat：{everyMs: 毫秒，至少 300000}。",
        },
        task: {
          type: "object",
          description:
            "{type: 'distillation'} 或 {type: 'agent', prompt: string}，背景任務要做的事。",
        },
      },
    },
    replay: "safe",
    async execute(input: JsonValue, context): Promise<ToolOutcome> {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return failure("schedule_propose 需要 object 輸入");
      }
      const record = input as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      if (title.length === 0) {
        return failure("schedule_propose 需要非空的 title 字串");
      }
      try {
        const kind = parseScheduleKind(record.kind);
        const spec = parseScheduleSpec(kind, record.spec);
        parseScheduleTask(record.task);
        const nowIso = now().toISOString();
        const schedule = schedules.create({
          name: title,
          kind,
          rawSpec: record.spec,
          rawTask: record.task,
          createdBy: "agent",
          sourceConversationId: context.conversationId,
          nextRunAt: computeFirstRun(spec, nowIso),
        });
        return {
          ok: true,
          content: [
            {
              type: "text",
              text: `已建立排程「${schedule.name}」（${schedule.kind}），首次執行 ${schedule.nextRunAt}。`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure(message);
      }
    },
  };
}

function failure(message: string): ToolOutcome {
  return {
    ok: false,
    message,
  };
}
