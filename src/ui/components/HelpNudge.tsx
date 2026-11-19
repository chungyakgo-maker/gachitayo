// 메인: 처음 깐 사람에게 한 번만 "디고 처음이세요? 기능 알아보기" (설계 docs/superpowers/specs/2026-11-18-help-design.md).
// 처음 사람은 설정까지 잘 안 들어가서 메인에 띄운다. 누르거나 ✕ 하면 폰에 기억해 다시 안 띄운다.
// 팀 주행·방 알림이 떠 있으면 그것이 먼저 (알림이 겹겹이 쌓이지 않게)
import { useState } from 'react';
import { useGroup } from '../../app/group';
import { useTeams } from '../../app/teams';

export const HELP_NUDGE_KEY = 'gachitayo.helpNudge.v1';

function seen(): boolean {
  try {
    return localStorage.getItem(HELP_NUDGE_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(HELP_NUDGE_KEY, '1');
  } catch {
    // 저장할 수 없으면(사생활 보호 모드) 이번 실행 동안만 숨긴다
  }
}

export function HelpNudge() {
  const [hidden, setHidden] = useState(seen);
  const ts = useTeams();
  const g = useGroup();
  if (hidden || g.room || ts.teams.some((t) => t.drive && t.drive.count > 0)) return null;
  const done = () => {
    remember();
    setHidden(true);
  };
  return (
    <div className="notice help-nudge">
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong>디고 처음이세요?</strong>
        <br />
        <span className="dim">그림으로 기능을 알아봐요</span>
      </span>
      <a
        className="btn small accent"
        href="#/help"
        onClick={(e) => {
          // 알림을 숨기면 링크가 화면에서 빠져 브라우저가 이동을 취소할 수 있다 (최종 검토 지적) → 직접 옮긴다
          e.preventDefault();
          done();
          window.location.hash = '#/help';
        }}
      >
        기능 알아보기
      </a>
      <button type="button" className="help-nudge-x" aria-label="알림 닫기" onClick={done}>
        ✕
      </button>
    </div>
  );
}
