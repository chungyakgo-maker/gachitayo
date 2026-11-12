// 화면 표시용 형식 함수. 사양서 8장: 시각은 기기 시간대와 관계없이 KST로 표시한다.

/** KST는 일광 절약 시간이 없어서 항상 UTC+9다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** epoch(ms) → "YYYY-MM-DD HH:mm" (KST) */
export function formatKst(epochMs: number): string {
  const d = new Date(epochMs + KST_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
}

/** 경과 시간 ms → "m:ss" 또는 "h:mm:ss" (초 미만 버림) */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

const MINUS = '−';

/**
 * 랩타임 (M5 결정 4): 끝난 랩은 소수 셋째 자리(2:04.318), 진행 중 랩은 첫째 자리(1:12.4).
 * 자릿수 밖은 버린다 (진행 중 시계가 미리 올라가지 않게).
 */
export function formatLapTime(ms: number | null, digits: 1 | 3): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const unit = digits === 3 ? 1 : 100;
  const total = Math.max(0, Math.floor(ms / unit));
  const frac = total % (digits === 3 ? 1000 : 10);
  const sec = Math.floor(total / (digits === 3 ? 1000 : 10));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const f = String(frac).padStart(digits, '0');
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}.${f}` : `${m}:${pad2(s)}.${f}`;
}

/** 델타 초: +0.42 / −0.31 / ±0.00 (사양서 7.11: 소수 둘째 자리) */
export function formatDelta(sec: number | null, digits = 2): string {
  if (sec === null || !Number.isFinite(sec)) return '—';
  const v = Math.round(Math.abs(sec) * 10 ** digits) / 10 ** digits;
  const body = v.toFixed(digits);
  if (v === 0) return `±${body}`;
  return `${sec < 0 ? MINUS : '+'}${body}`;
}

/** epoch ms → "오늘" 또는 "11월 8일" (KST) */
export function formatDayKst(epochMs: number, nowMs = Date.now()): string {
  const d = new Date(epochMs + KST_OFFSET_MS);
  const n = new Date(nowMs + KST_OFFSET_MS);
  if (d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate()) {
    return '오늘';
  }
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/** 코스 길이 m → "3.9km" / "860m" */
export function formatLength(m: number | null): string {
  if (m === null) return '길이 미정';
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}
