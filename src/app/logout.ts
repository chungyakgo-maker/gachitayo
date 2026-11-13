// 로그아웃 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md 5.6·5.7-2):
// 주행·되살리기 중이거나 올리지 못한 것이 있으면 막는다. 통과하면 서버에서 이 폰 열쇠를 지우고,
// 폰 저장소(기록·원본·결과·코스·비교 랩·대기열)와 계정 정보를 지운 뒤 첫 화면으로 간다. 설정은 남긴다.
// (account.ts에 두면 recording·restore와 서로 불러오게 되어 따로 둔다)
import { forgetAccount, friendlyServerError, logoutRemote } from './account';
import { clearLocalData, getQueueRepo, getRecordingState } from './recording';
import { getRestoreState, localOnlySessions } from './restore';

/** 첫 화면으로 다시 열기 (테스트에서 바꿔 끼운다) */
export const logoutNav = {
  reload: () => {
    window.location.replace(`${window.location.pathname}#/`);
    window.location.reload();
  },
};

export type LogoutCheck = { ok: true; localOnly: number } | { ok: false; error: string };

/** 로그아웃할 수 있는지와, 지우면 되살릴 수 없는 이 폰에만 있는 기록 수 */
export async function logoutCheck(): Promise<LogoutCheck> {
  if (getRecordingState().phase !== 'idle' || getRestoreState().running) return { ok: false, error: '주행이나 되살리기가 끝난 뒤에 로그아웃할 수 있어요' };
  if ((await getQueueRepo().count()) > 0) return { ok: false, error: '아직 올리지 못한 기록이 있어요. 올린 뒤에 다시 해 주세요' };
  try {
    return { ok: true, localOnly: (await localOnlySessions()).length };
  } catch {
    return { ok: false, error: '통신이 연결돼야 로그아웃할 수 있어요' };
  }
}

export async function logout(): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await logoutCheck();
  if (!c.ok) return c;
  try {
    await logoutRemote();
  } catch (e) {
    return { ok: false, error: e instanceof TypeError ? '통신이 연결돼야 로그아웃할 수 있어요' : friendlyServerError(e) };
  }
  await clearLocalData();
  forgetAccount();
  logoutNav.reload();
  return { ok: true };
}
