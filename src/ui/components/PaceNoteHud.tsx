// 커브 표지판 칸 (사양서 8.4, 사용자 요청 시안): 지도 모드 위쪽 칸 중 하나. 큰 표지판 + 남은 거리,
// 바로 이어지는 커브는 거리 아래 작은 표지판 (글자 "이어서"·조여짐·풀림·길게는 두지 않는다, 사용자 요청).
// 다음 커브가 보이는 거리 밖이거나 랩 밖이면 회색 직진 표지판.
import type { UpcomingNote } from '../../engine/course/paceNotes';
import { PaceIdleSign, PaceNoteSign } from './PaceNoteSign';

const MAIN = 74;
const MINI = 34;

export function PaceNoteTile({ up }: { up: UpcomingNote | null }) {
  return (
    <div className="tile pace-tile" aria-live="polite">
      {up ? (
        <>
          <PaceNoteSign dir={up.note.dir} grade={up.note.grade} mod={up.note.mod} size={MAIN} />
          <div className="pace-side">
            <span className="pace-dist">
              {up.distM}
              <small>m</small>
            </span>
            {up.then && <PaceNoteSign dir={up.then.dir} grade={up.then.grade} mod={up.then.mod} size={MINI} />}
          </div>
        </>
      ) : (
        <PaceIdleSign size={MAIN} />
      )}
    </div>
  );
}
