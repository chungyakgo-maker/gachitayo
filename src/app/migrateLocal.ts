// 처음 한 번 옮기기 (기록은 폰에만 3단계, 설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md):
// 1.0.1 부터 기록을 서버에 안 올린다. 예전 앱이 올려 둔 기록이 서버에만 남아 있으면 그대로 사라지므로, 서버 열쇠가 있는 계정이면
// (카카오·애플·로그인 없이 시작한 계정 모두 — 예전 앱은 모두 올렸다) 계정마다 한 번 restore.ts 로 받아 둔다.
// 하나라도 실패하면 기억하지 않아 다음 실행·다음 로그인 때 다시 한다 (받은 것은 같은 id 라 두 번 생기지 않는다). 5번 실패하면 그만한다
import { serverConfig } from '../server/config';
import { getAuth } from './account';
import { markMigrated, migratedUsers, noteMigrationFailure } from './migrationState';
import { startRestore } from './restore';

export { migratedUsers };

/** 앱 시작·로그인 뒤: 이 계정이 아직 안 옮겼으면 옮긴다 */
export async function startMigrateLocal(): Promise<void> {
  const auth = getAuth();
  if (!auth || !serverConfig.apiUrl || migratedUsers().includes(auth.userId)) return;
  // 돌고 있던 것이 다른 계정 것이면 그 계정으로 센다 (애플 로그인은 화면을 다시 열지 않아 계정이 바뀐 채 이어질 수 있다)
  const r = await startRestore();
  if (!r.userId) return;
  if (r.ok) markMigrated(r.userId);
  else noteMigrationFailure(r.userId);
}
