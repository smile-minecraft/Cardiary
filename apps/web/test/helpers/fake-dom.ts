/**
 * 測試用的極簡 DOM。
 *
 * 只實作畫面程式實際用到的節點操作：建立元素、設定屬性、追加與取代子節點、
 * 事件監聽與觸發。不模擬版面、樣式與瀏覽器的其他行為。
 */

export class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: Array<FakeElement | string> = [];
  readonly listeners = new Map<string, Array<(event: Event) => void>>();

  disabled = false;
  hidden = false;
  selected = false;
  value = "";
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;

  #text: string | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  get childElementCount(): number {
    return this.children.filter((child) => child instanceof FakeElement).length;
  }

  get textContent(): string {
    if (this.#text !== null) return this.#text;
    return this.children
      .map((child) => (typeof child === "string" ? child : child.textContent))
      .join("");
  }

  set textContent(value: string) {
    this.#text = value;
    this.children.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type: string): void {
    const event = { type, preventDefault: () => {} } as unknown as Event;
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  append(...children: Array<FakeElement | string | null | undefined | false>): void {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      this.children.push(child);
    }
  }

  replaceChildren(...children: Array<FakeElement | string | null | undefined | false>): void {
    this.children.length = 0;
    this.#text = null;
    this.append(...children);
  }
}

export function installFakeDocument(): void {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: (tagName: string) => new FakeElement(tagName) },
  });
}

export function elementAt(parent: FakeElement, index: number): FakeElement {
  const child = parent.children[index];
  if (!(child instanceof FakeElement)) {
    throw new Error(`第 ${index} 個子節點不是元素`);
  }
  return child;
}

export function elementChildren(element: FakeElement): FakeElement[] {
  return element.children.filter((child): child is FakeElement => child instanceof FakeElement);
}

export function descendants(root: FakeElement): FakeElement[] {
  const found: FakeElement[] = [root];
  for (const child of elementChildren(root)) {
    found.push(...descendants(child));
  }
  return found;
}

export function screenButtons(root: FakeElement): FakeElement[] {
  return descendants(root).filter((element) => element.tagName === "button");
}
