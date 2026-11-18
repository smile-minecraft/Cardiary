/**
 * 極小的 Markdown 呈現：只建 DOM 節點，不碰 innerHTML，原始 HTML 一律當純文字。
 *
 * 支援助理回覆與通知最常見的寫法：段落、標題、項目與編號清單、引言、
 * 程式碼區塊、行內程式碼、粗體與斜體。連結只顯示文字與網址，不建立可點擊的
 * `<a>`；遠端客戶端不替代理開外部網頁。
 */

import { h } from "./dom";

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; text: string };

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      index += 1;
      continue;
    }
    const listMatch = LIST_ITEM.exec(line);
    if (listMatch) {
      const ordered = listMatch[2] !== undefined;
      const items: string[] = [];
      while (index < lines.length) {
        const match = LIST_ITEM.exec(lines[index] ?? "");
        if (!match || (match[2] !== undefined) !== ordered) break;
        items.push(match[3] ?? "");
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (
        current.trim() === "" ||
        /^\s*```/.test(current) ||
        /^#{1,6}\s/.test(current) ||
        LIST_ITEM.test(current) ||
        /^\s*>/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

/** 行內語法：`code`、**粗體**、*斜體*／_斜體_、[文字](網址)。 */
export function renderInline(text: string): Array<Node | string> {
  const out: Array<Node | string> = [];
  const pattern =
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1] !== undefined) out.push(h("code", { class: "md-code" }, match[1]));
    else if (match[2] !== undefined) out.push(h("strong", {}, match[2]));
    else if (match[3] !== undefined) out.push(h("em", {}, match[3]));
    else if (match[4] !== undefined) out.push(h("em", {}, match[4]));
    else if (match[5] !== undefined) {
      out.push(h("span", { class: "md-link", title: match[6] ?? "" }, match[5]));
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inlineWithBreaks(lines: string[]): Array<Node | string> {
  const out: Array<Node | string> = [];
  lines.forEach((line, index) => {
    if (index > 0) out.push(h("br"));
    out.push(...renderInline(line));
  });
  return out;
}

/** 把 Markdown 轉成一組區塊元素，放進 `container`（會先清空）。 */
export function renderMarkdown(container: HTMLElement, source: string): void {
  const nodes: HTMLElement[] = [];
  for (const block of parseBlocks(source)) {
    switch (block.kind) {
      case "paragraph":
        nodes.push(h("p", {}, ...inlineWithBreaks(block.lines)));
        break;
      case "heading":
        nodes.push(
          h(block.level <= 2 ? "h3" : "h4", { class: "md-heading" }, ...renderInline(block.text)),
        );
        break;
      case "list": {
        const list = h(block.ordered ? "ol" : "ul", { class: "md-list" });
        for (const item of block.items) list.append(h("li", {}, ...renderInline(item)));
        nodes.push(list);
        break;
      }
      case "quote":
        nodes.push(h("blockquote", { class: "md-quote" }, ...inlineWithBreaks(block.lines)));
        break;
      case "code":
        nodes.push(h("pre", { class: "md-pre" }, h("code", {}, block.text)));
        break;
    }
  }
  container.replaceChildren(...nodes);
}
