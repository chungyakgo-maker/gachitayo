// 로그아웃 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md 5.6 → 기록은 폰에만 2026-11-18 6단계):
// 주행·옮기기 중이면 막는다. 서버에서 이 폰 열쇠를 지우고(통신이 안 돼도 폰에서는 로그아웃 — 기록은 서버에 없으니 기다릴 것이 없다),
// 계정 정보를 지운 뒤 첫 화면으로 간다. 기록·코스·즐겨찾기는 기본으로 남기고 "지우기"를 골랐을 때만 지운다. 설정은 늘 남긴다.
// (account.ts에 두면 recording·restore와 서로 불러오게 되어 따로 둔다)
import { forgetAccount, logoutRemote } from './account';
import { clearCoursePrefs } from './coursePrefs';
import { leaveGroupLocal } from './group';
import { clearLocalData, getRecordingState } from './recording';
import { getRestoreState } from './restore';

/** 첫 화면으로 다시 열기 (테스트에서 바꿔 끼운다) */
export const logoutNav = {
  reload: () => {
    window.location.replace(`${window.location.pathname}#/`);
    window.location.reload();
  },
};

export type LogoutCheck = { ok: true } | { ok: false; error: string };

/** 로그아웃할 수 있는지 */
export async function logoutCheck(): Promise<LogoutCheck> {
  if (getRecordingState().phase !== 'idle' || getRestoreState().running) return { ok: false, error: '주행이나 옮기기가 끝난 뒤에 로그아웃할 수 있어요' };
  return { ok: true };
}

export async function logout(opts: { wipe: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await logoutCheck();
  if (!c.ok) return c;
  try {
    await logoutRemote();
  } catch {
    // 서버 열쇠는 다음에 쓸 일이 없다(이 폰에서 잊는다). 통신이 안 돼도 로그아웃은 된다
  }
  if (opts.wipe) {
    await clearLocalData();
    // 즐겨찾기·분류도 이 폰에서 지운다
    clearCoursePrefs();
  }
  // 그룹 주행 방은 언제나 잊는다 (다음 계정으로 옮겨 가지 않게)
  leaveGroupLocal();
  forgetAccount();
  logoutNav.reload();
  return { ok: true };
}
