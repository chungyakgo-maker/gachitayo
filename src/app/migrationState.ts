// 처음 한 번 옮기기 상태 (기록은 폰에만 3단계): 끝난 계정과 실패 횟수. records.ts(지우기)·migrateLocal.ts 가 같이 본다
// (서로 불러오는 고리를 만들지 않게 따로 둔다)
const DONE_KEY = 'gachitayo.localOnly.v1';
const TRIES_KEY = 'gachitayo.localOnlyTries.v1';
/** 이만큼 실패하면 그만한다: 서버에 원본이 없거나 계산이 늘 실패하는 기록 때문에 매번 받지 않게 (검토 지적) */
export const MIGRATE_MAX_TRIES = 5;

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 저장할 수 없으면 다음 실행 때 한 번 더 확인한다 (같은 id 라 겹치지 않는다)
  }
}

/** 옮기기가 끝난 계정 번호 */
export function migratedUsers(): string[] {
  const v = readJson<unknown>(DONE_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
export function markMigrated(userId: string): void {
  writeJson(DONE_KEY, [...new Set([...migratedUsers(), userId])]);
}
/** 실패를 하나 센다. MIGRATE_MAX_TRIES 번째면 끝난 것으로 치고 true */
export function noteMigrationFailure(userId: string): boolean {
  const tries = readJson<Record<string, number>>(TRIES_KEY, {});
  const n = (Number(tries[userId]) || 0) + 1;
  writeJson(TRIES_KEY, { ...tries, [userId]: n });
  if (n < MIGRATE_MAX_TRIES) return false;
  markMigrated(userId);
  return true;
}
