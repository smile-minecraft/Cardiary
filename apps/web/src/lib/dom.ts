/**
 * 建立元素的小工具。文字一律走 textContent，不碰 innerHTML。
 */

import type { Language } from "../i18n";

export type Child = Node | string | null | undefined | false;

type HandlerMap = Partial<Record<string, (event: Event) => void>>;
type Attrs = {
  [key: string]: string | HandlerMap | undefined;
  on?: HandlerMap;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  const { on, ...rest } = attrs;
  for (const [key, value] of Object.entries(rest)) {
    if (key === "text") {
      element.textContent = String(value);
    } else {
      element.setAttribute(key, String(value));
    }
  }
  if (on) {
    for (const [event, handler] of Object.entries(on)) {
      if (handler) element.addEventListener(event, handler);
    }
  }
  element.append(...children.filter(isChild));
  return element;
}

function isChild(child: Child): child is Node | string {
  return child !== null && child !== undefined && child !== false;
}

/** 清空元素並放入新的子節點。 */
export function replaceChildren(element: Element, ...children: Child[]): void {
  element.replaceChildren(...children.filter(isChild));
}

/** RFC 3339 時間轉成本機短時間；解析失敗就回原字串。 */
export function formatTime(rfc3339: string, language: Language): string {
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return rfc3339;
  return date.toLocaleString(language, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
