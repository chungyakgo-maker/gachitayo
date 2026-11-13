// 커브 표지판 칸 (사양서 8.4, 사용자 요청 시안): 위쪽 칸 3개 아래 정가운데. 큰 표지판 + 남은 거리 + 붙는 말,
// 바로 이어지는 커브는 오른쪽에 작게 "이어서". 다음 커브가 없으면 빈 칸(자리는 그대로 둬 지도가 흔들리지 않게).
import type { CSSProperties } from 'react';
import type { UpcomingNote } from '../../engine/course/paceNotes';
import { PaceNoteSign } from './PaceNoteSign';

/** 표지판 칸이 차지하는 높이 (위 10 + 표지판 96 + 간격 6 + 거리 칸 26 + 여유 8). 지도 위쪽 여백에 더한다 */
export const PACE_HUD_RESERVE_PX = 146;
const MAIN = 96;
const MINI = 54;

export function PaceNoteHud({ up, style }: { up: UpcomingNote | null; style?: CSSProperties }) {
  return (
    <div className="pace-hud" style={style} aria-live="polite">
      {up && (
        <div className="pace-main">
          <PaceNoteSign dir={up.note.dir} grade={up.note.grade} mod={up.note.mod} size={MAIN} />
          <div className="pace-row">
            <span className="pace-dist">
              {up.distM}
              <small>m</small>
            </span>
            {up.note.mod && <span className="pace-mod">{up.note.mod}</span>}
          </div>
          {up.then && (
            <div className="pace-next" style={{ left: MAIN + 10 }}>
              <span>이어서</span>
              <PaceNoteSign dir={up.then.dir} grade={up.then.grade} mod={up.then.mod} size={MINI} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
