// 작은 XML 파서 (GPX용). 브라우저 DOMParser 없이 어디서나 동작한다 (사양서 5.1: gpx/는 DOM을 쓰지 않는다).
// 요소, 속성, 글자, 엔티티, 주석, CDATA, 처리 지시(<?xml?>), DOCTYPE을 다룬다.

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** 바로 아래 글자 (자식 요소의 글자는 포함하지 않음) */
  text: string;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

function fail(msg: string): never {
  throw new Error(`XML 형식 오류: ${msg}`);
}

export function parseXml(text: string): XmlNode {
  const src = text.replace(/^﻿/, '');
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1]!.text += decode(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1]!.text += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt);
      if (e < 0) fail('주석이 닫히지 않았습니다');
      i = e + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt);
      if (e < 0) fail('CDATA가 닫히지 않았습니다');
      stack[stack.length - 1]!.text += src.slice(lt + 9, e);
      i = e + 3;
    } else if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt);
      if (e < 0) fail('처리 지시가 닫히지 않았습니다');
      i = e + 2;
    } else if (src.startsWith('<!', lt)) {
      const e = src.indexOf('>', lt);
      if (e < 0) fail('선언이 닫히지 않았습니다');
      i = e + 1;
    } else if (src.startsWith('</', lt)) {
      const e = src.indexOf('>', lt);
      if (e < 0) fail('닫는 태그가 끝나지 않았습니다');
      const name = src.slice(lt + 2, e).trim();
      const top = stack.pop();
      if (!top || top.name !== name) fail(`<${top?.name ?? '?'}>와 </${name}>가 맞지 않습니다`);
      i = e + 1;
    } else {
      const e = findTagEnd(src, lt);
      const body = src.slice(lt + 1, e);
      const selfClose = body.endsWith('/');
      const inner = selfClose ? body.slice(0, -1) : body;
      const m = /^([^\s/>]+)/.exec(inner);
      if (!m) fail('태그 이름이 없습니다');
      const node: XmlNode = { name: m[1]!, attrs: {}, children: [], text: '' };
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = re.exec(inner.slice(m[1]!.length)))) node.attrs[a[1]!] = decode(a[3] ?? a[4] ?? '');
      stack[stack.length - 1]!.children.push(node);
      if (!selfClose) stack.push(node);
      i = e + 1;
    }
  }
  if (stack.length !== 1) fail(`<${stack[stack.length - 1]!.name}>가 닫히지 않았습니다`);
  const el = root.children;
  if (el.length !== 1) fail(el.length === 0 ? '요소가 없습니다' : '최상위 요소가 하나가 아닙니다');
  return el[0]!;
}

/** 따옴표 안의 >는 건너뛰고 태그 끝을 찾는다 */
function findTagEnd(src: string, from: number): number {
  let q: string | null = null;
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return fail('태그가 닫히지 않았습니다');
}

/** 이름공간 접두사를 뺀 이름 (gpxtpx:speed → speed) */
export const localName = (n: XmlNode): string => n.name.slice(n.name.indexOf(':') + 1);

export const childrenNamed = (n: XmlNode, local: string): XmlNode[] => n.children.filter((c) => localName(c) === local);

export const childText = (n: XmlNode, local: string): string | null => {
  const c = childrenNamed(n, local)[0];
  return c ? c.text.trim() : null;
};

/** 자손 중 이름이 같은 첫 요소 */
export function findDescendant(n: XmlNode, local: string): XmlNode | null {
  for (const c of n.children) {
    if (localName(c) === local) return c;
    const d = findDescendant(c, local);
    if (d) return d;
  }
  return null;
}
