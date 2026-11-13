// 계정 삭제 (사양서 13.3, 애플 심사 필수): 닉네임·친구·코스·주행 기록을 서버와 폰에서 모두 지운다. 되돌릴 수 없다.
// 서버 먼저 지우고, 성공해야 폰을 지운다(통신이 끊겨 서버만 남는 일이 없게, 실패하면 다시 시도할 수 있다).
// 계정 모듈과 기록 모듈을 함께 쓰므로 따로 둔다 (서로 가져오는 고리를 만들지 않게).
import Dexie from 'dexie';
import { ApiError, apiFetch } from '../server/api';
import { friendlyServerError, getAuth } from './account';
import { getRecordingState } from './recording';

export async function deleteAccount(opts: { reload?: () => void } = {}): Promise<void> {
  if (getRecordingState().phase === 'recording') throw new Error('주행 중에는 계정을 지울 수 없어요');
  const auth = getAuth();
  if (auth) {
    try {
      await apiFetch('DELETE', '/api/me', { token: auth.token });
    } catch (e) {
      // 서버가 이 열쇠를 모르면(이미 끊긴 계정) 서버에서 지울 것이 없다. 폰만 지운다
      if (!(e instanceof ApiError && e.status === 401)) throw new Error(friendlyServerError(e));
    }
  }
  // 열린 연결은 Dexie가 알아서 닫는다
  await Dexie.delete('gachitayo');
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('gachitayo.')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // 저장소를 못 쓰는 환경
  }
  (opts.reload ?? (() => window.location.reload()))();
}
