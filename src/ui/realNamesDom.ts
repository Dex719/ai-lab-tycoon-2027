// Показ настоящих названий поверх интерфейса (настройка «Оригинальные названия»).
// Наблюдатель за DOM переписывает текстовые узлы и подсказки через toRealNames; исходные строки хранятся рядом,
// поэтому выключение возвращает игровые названия без перезагрузки. Поля ввода не трогаем.

import { toRealNames } from '../data/realNames';
import { getSettings } from './settings';

const ATTRS = ['title', 'data-tip', 'placeholder', 'aria-label'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

// Что мы подставили и что было до подстановки: если узел позже изменил React, значения уже не совпадут.
const textOrig = new WeakMap<Text, { orig: string; shown: string }>();
const attrOrig = new WeakMap<Element, Map<string, { orig: string; shown: string }>>();

let observer: MutationObserver | null = null;

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName) || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function rewriteText(node: Text): void {
  if (skipped(node.parentElement)) return;
  const cur = node.nodeValue ?? '';
  const prev = textOrig.get(node);
  if (prev && prev.shown === cur) return; // уже показано настоящее
  const next = toRealNames(cur);
  if (next === cur) {
    textOrig.delete(node);
    return;
  }
  textOrig.set(node, { orig: cur, shown: next });
  node.nodeValue = next;
}

function rewriteAttr(el: Element, name: string): void {
  const cur = el.getAttribute(name);
  if (cur === null) return;
  const m = attrOrig.get(el);
  const prev = m?.get(name);
  if (prev && prev.shown === cur) return;
  const next = toRealNames(cur);
  if (next === cur) {
    m?.delete(name);
    return;
  }
  const map = m ?? new Map<string, { orig: string; shown: string }>();
  map.set(name, { orig: cur, shown: next });
  attrOrig.set(el, map);
  el.setAttribute(name, next);
}

function rewriteTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    rewriteText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = root; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) rewriteText(n as Text);
    else for (const a of ATTRS) rewriteAttr(n as Element, a);
  }
}

function restoreTree(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = root; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      const rec = textOrig.get(t);
      if (rec && t.nodeValue === rec.shown) t.nodeValue = rec.orig;
      textOrig.delete(t);
    } else {
      const el = n as Element;
      const m = attrOrig.get(el);
      if (m) {
        for (const [name, rec] of m) if (el.getAttribute(name) === rec.shown) el.setAttribute(name, rec.orig);
        attrOrig.delete(el);
      }
    }
  }
}

/** Включает или выключает показ настоящих названий. Безопасно вызывать повторно. */
export function applyRealNames(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) {
    if (observer) return;
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') rewriteText(r.target as Text);
        else if (r.type === 'attributes') rewriteAttr(r.target as Element, r.attributeName ?? '');
        else r.addedNodes.forEach(rewriteTree);
      }
    });
    rewriteTree(document.body);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  } else if (observer) {
    observer.disconnect();
    observer = null;
    restoreTree(document.body);
  }
}

/** Применяет сохранённую настройку при запуске. */
export function initRealNames(): void {
  applyRealNames(getSettings().realNames);
}
