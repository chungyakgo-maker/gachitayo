// 처음 한 번 옮기기 (기록은 폰에만 3단계, 설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md):
// 1.0.1 부터 기록을 서버에 안 올린다. 예전 앱이 올려 둔 기록이 서버에만 남아 있으면 그대로 사라지므로, 서버 열쇠가 있는 계정이면
// (카카오·애플·로그인 없이 시작한 계정 모두 — 예전 앱은 모두 올렸다) 계정마다 한 번 restore.ts 로 받아 둔다.
// 하나라도 실패하면 기억하지 않아 다음 실행·다음 로그인 때 다시 한다 (받은 것은 같은 id 라 두 번 생기지 않는다).
import { serverConfig } from '../server/config';
import { getAuth } from './account';
import { startRestore } from './restore';

const KEY = 'gachitayo.localOnly.v1';

/** 옮기기가 끝난 계정 번호 */
export function migratedUsers(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function remember(userId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set([...migratedUsers(), userId])]));
  } catch {
    // 저장할 수 없으면 다음 실행 때 한 번 더 확인한다 (같은 id 라 겹치지 않는다)
  }
}

/** 앱 시작·로그인 뒤: 이 계정이 아직 안 옮겼으면 옮긴다 */
export async function startMigrateLocal(): Promise<void> {
  const auth = getAuth();
  if (!auth || !serverConfig.apiUrl || migratedUsers().includes(auth.userId)) return;
  if (await startRestore()) remember(auth.userId);
}
