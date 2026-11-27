// courses/ 폴더 → 기본 코스 (2026-11-27 세영 "gpx를 너한테 주는거말고 내가 직접 올리려면" → "1번 ㄱ"):
// 세영이 GitHub 웹 화면에서 courses/<코스 폴더>/ 에 GPX 하나와 정보.txt 를 올리면, 빌드·배포 때 이 스크립트가
// src/courses/builtinUser.gen.ts(이름·설명 등) 와 builtinUserPoints.gen.ts(점) 를 만든다 → 기본 코스 목록 맨 뒤에 붙는다.
// 잘못된 파일이면 무엇이 틀렸는지 한국어로 알리고 멈춘다 (배포가 되지 않는다). 사용법은 courses/README.md
// 폴더 이름이 _ 나 . 로 시작하면 건너뛴다 (_예시).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
// 시험할 때만 다른 폴더로 (COURSES_DIR · COURSES_OUT)
const DIR = process.env.COURSES_DIR ?? join(ROOT, 'courses');
const OUT = process.env.COURSES_OUT ?? join(ROOT, 'src/courses');
const OUT_META = join(OUT, 'builtinUser.gen.ts');
const OUT_POINTS = join(OUT, 'builtinUserPoints.gen.ts');
const TAGS = { 서킷: 'circuit', '산 길': 'mountain', 산길: 'mountain', '해안 길': 'coast', 해안길: 'coast' };

const errors = [];
const fail = (folder, msg) => errors.push(`courses/${folder}: ${msg}`);

/** 정보.txt: "항목: 값" 줄들. 설명·예전 이름은 여러 줄 가능 */
function readInfo(folder, text) {
  const info = { desc: [], oldNames: [] };
  for (const [n, raw] of text.replace(/^﻿/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([^:：]+)[:：]\s*(.*)$/.exec(line);
    if (!m) {
      fail(folder, `정보.txt ${n + 1}번째 줄 "${line}" — "항목: 값" 모양이어야 해요`);
      continue;
    }
    const k = m[1].trim();
    const v = m[2].trim();
    if (k === '이름') info.name = v;
    else if (k === '지역') info.route = v;
    else if (k === '설명') v && info.desc.push(v);
    else if (k === '예전 이름') v && info.oldNames.push(v);
    else if (k === '트랙') info.track = v;
    else if (k === '키') info.key = v;
    else if (k === '분류') {
      info.tags = [];
      for (const t of v.split(/[,，]/).map((s) => s.trim()).filter(Boolean)) {
        if (TAGS[t]) info.tags.push(TAGS[t]);
        else fail(folder, `분류 "${t}" — 서킷 · 산 길 · 해안 길 중에서 골라 주세요`);
      }
    } else if (k === '고침') {
      const r = Number(v);
      if (Number.isInteger(r) && r >= 1) info.rev = r;
      else fail(folder, `고침 "${v}" — 1, 2, 3 같은 숫자여야 해요`);
    } else fail(folder, `정보.txt 의 "${k}" — 모르는 항목이에요 (이름·지역·분류·설명·고침·트랙·키·예전 이름)`);
  }
  if (!info.name) fail(folder, '정보.txt 에 "이름: …" 줄이 없어요');
  if (!info.route) fail(folder, '정보.txt 에 "지역: …" 줄이 없어요');
  return info;
}

/** GPX 의 트랙들 [{name, pts}] (트랙 안 구간은 이어 붙인다) */
function readTracks(xml) {
  const out = [];
  for (const m of xml.matchAll(/<trk\b[^>]*>([\s\S]*?)<\/trk>/g)) {
    const name = (/<name>([\s\S]*?)<\/name>/.exec(m[1])?.[1] ?? '').trim();
    const pts = [];
    for (const p of m[1].matchAll(/<trkpt\b([^>]*)>/g)) {
      const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(p[1])?.[1];
      const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(p[1])?.[1];
      pts.push([Number(lat), Number(lon)]);
    }
    out.push({ name, pts });
  }
  return out;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

const meta = [];
const points = {};
const folders = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => !f.startsWith('_') && !f.startsWith('.') && statSync(join(DIR, f)).isDirectory())
      .sort((a, b) => a.localeCompare(b, 'ko'))
  : [];
for (const folder of folders) {
  const files = readdirSync(join(DIR, folder));
  const infoFile = files.find((f) => f.normalize('NFC') === '정보.txt');
  const gpxFiles = files.filter((f) => /\.gpx$/i.test(f));
  if (!infoFile) {
    fail(folder, '정보.txt 가 없어요');
    continue;
  }
  if (gpxFiles.length !== 1) {
    fail(folder, `GPX 파일이 ${gpxFiles.length}개예요 — 폴더마다 하나만 넣어 주세요`);
    continue;
  }
  const info = readInfo(folder, readFileSync(join(DIR, folder, infoFile), 'utf8'));
  const tracks = readTracks(readFileSync(join(DIR, folder, gpxFiles[0]), 'utf8'));
  let track;
  if (info.track) {
    track = tracks.find((t) => t.name === info.track);
    if (!track) fail(folder, `트랙 "${info.track}" 이 GPX 에 없어요 (있는 트랙: ${tracks.map((t) => t.name || '이름 없음').join(', ')})`);
  } else if (tracks.length !== 1) {
    fail(folder, `GPX 에 트랙이 ${tracks.length}개예요 — 정보.txt 에 "트랙: 트랙 이름" 으로 하나를 골라 주세요 (있는 트랙: ${tracks.map((t) => t.name || '이름 없음').join(', ')})`);
  } else track = tracks[0];
  if (!track) continue;
  const pts = track.pts.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180);
  if (pts.length < 10) {
    fail(folder, `GPX 트랙 점이 ${pts.length}개뿐이에요 (10개 이상 필요)`);
    continue;
  }
  const key = info.key ?? `c-${createHash('sha1').update(folder.normalize('NFC')).digest('hex').slice(0, 10)}`;
  if (!/^[a-z0-9-]{1,64}$/.test(key)) {
    fail(folder, `키 "${key}" — 영어 소문자·숫자·- 만 써 주세요`);
    continue;
  }
  const b = { key, name: info.name, route: info.route };
  if (info.desc.length) b.desc = info.desc;
  if (info.oldNames.length) b.oldNames = info.oldNames;
  if (info.tags?.length) b.tags = [...new Set(info.tags)];
  if (info.rev) b.rev = info.rev;
  meta.push(b);
  points[key] = pts.flatMap(([a, o]) => [round6(a), round6(o)]);
}
const keys = meta.map((b) => b.key);
for (const k of keys) if (keys.indexOf(k) !== keys.lastIndexOf(k)) errors.push(`키 "${k}" 가 두 폴더에 있어요`);

if (errors.length) {
  for (const e of errors) console.log(`::error::기본 코스 파일 오류 — ${e}`);
  console.error(`\n기본 코스 파일(courses/)에 고칠 곳이 ${errors.length}개 있어요. 위 내용을 보고 고쳐 다시 올려 주세요.`);
  process.exit(1);
}

const head = '// 자동으로 만든 파일 — 손으로 고치지 않는다. courses/ 폴더에서 scripts/builtin-courses.mjs 가 만든다.\n';
writeFileSync(
  OUT_META,
  `${head}import type { BuiltinCourse } from './builtinMeta';\n\nexport const USER_BUILTINS: readonly BuiltinCourse[] = ${JSON.stringify(meta, null, 2)};\n`,
);
writeFileSync(OUT_POINTS, `${head}export const USER_POINTS: Record<string, number[]> = {\n${meta.map((b) => `  ${JSON.stringify(b.key)}: [${points[b.key].join(',')}],`).join('\n')}\n};\n`);
console.log(`기본 코스(courses/) ${meta.length}개: ${meta.map((b) => b.name).join(', ') || '없음'}`);
