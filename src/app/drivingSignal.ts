// 실시간 인기 신호 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md, 사용자 요청 "인기 도로 … 실시간"):
// 기본 코스로 주행 중이면 "이 코스 주행 중"(기본 코스 열쇠만, 위치 없음)을 2분마다 보낸다. 서버는 최근 10분 안에 신호 온 계정을 센다.
import { apiFetch } from '../server/api';
import { getAuth } from './account';
import { getDriveState, subscribeDrive } from './drive';

const EVERY_MS = 120_000;

export function startDrivingSignal(): () => void {
  let current: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const send = (builtin: string) => {
    const auth = getAuth();
    if (!auth) return;
    void apiFetch('POST', '/api/driving', { token: auth.token, body: { builtin } }).catch(() => {});
  };
  const check = () => {
    const s = getDriveState();
    const builtin = s.phase === 'driving' && !s.replay && s.course?.builtin ? s.course.builtin : null;
    if (builtin === current) return;
    current = builtin;
    if (timer) clearInterval(timer);
    timer = null;
    if (!builtin) return;
    send(builtin);
    timer = setInterval(() => send(builtin), EVERY_MS);
  };
  const unsub = subscribeDrive(check);
  check();
  return () => {
    unsub();
    if (timer) clearInterval(timer);
  };
}
