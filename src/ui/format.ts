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
