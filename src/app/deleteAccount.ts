// 계정 삭제 (사양서 13.3, 애플 심사 필수): 서버 계정(닉네임·친구·팀·프로필 사진·공개한 코스)을 지운다. 되돌릴 수 없다.
// 서버 먼저 지우고, 성공해야 폰을 지운다(통신이 끊겨 서버만 남는 일이 없게, 실패하면 다시 시도할 수 있다).
// 기록은 폰에만 (2026-11-18 6단계): 폰의 기록·코스·즐겨찾기는 wipe 를 골랐을 때만 지우고, 아니면 계정 열쇠만 지운다.
// 계정 모듈과 기록 모듈을 함께 쓰므로 따로 둔다 (서로 가져오는 고리를 만들지 않게).
import Dexie from 'dexie';
import { ApiError, apiFetch } from '../server/api';
import { friendlyServerError, getAuth } from './account';
import { getRecordingState } from './recording';
import { getGroup, leaveGroupRoom } from './group';

/** 기록을 남길 때도 지우지 않는 폰 설정·자료 (계정과 상관없는 것). 나머지 gachitayo.* 는 계정 것이라 지운다 */
export const KEEP_ON_ACCOUNT_DELETE: readonly string[] = [
  'gachitayo.settings',
  'gachitayo.coursePrefs.v1',
  'gachitayo.lastBackup.v1',
  'gachitayo.backupSnooze.v1',
  'gachitayo.helpNudge.v1',
  'gachitayo.driveZoom.v',
  'gachitayo.builtinRev',
  'gachitayo.lineMap.v1',
  'gachitayo.recentDest.v1',
  'gachitayo.locationGranted',
  'gachitayo.gapSafetyAck',
];

export async function deleteAccount(opts: { wipe: boolean; reload?: () => void }): Promise<void> {
  if (getRecordingState().phase === 'recording') throw new Error('주행 중에는 계정을 지울 수 없어요');
  const auth = getAuth();
  // 그룹 주행 방에서 먼저 나간다 (다른 사람 방에 내가 남지 않게, 실패해도 계속)
  if (getGroup().room) await leaveGroupRoom();
  if (auth) {
    try {
      await apiFetch('DELETE', '/api/me', { token: auth.token });
    } catch (e) {
      // 서버가 이 열쇠를 모르면(이미 끊긴 계정) 서버에서 지울 것이 없다. 폰만 지운다
      if (!(e instanceof ApiError && e.status === 401)) throw new Error(friendlyServerError(e));
    }
  }
  // 열린 연결은 Dexie가 알아서 닫는다
  if (opts.wipe) await Dexie.delete('gachitayo');
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('gachitayo.') && (opts.wipe || !KEEP_ON_ACCOUNT_DELETE.includes(k))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // 저장소를 못 쓰는 환경
  }
  (opts.reload ?? (() => window.location.reload()))();
}
