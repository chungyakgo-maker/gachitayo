// 팀 방 › 방장이 코스 정하기 (설계 3부, 시안 ⑨): 폰에 있는 코스(기본 코스·받아 둔 모두의 코스·즐겨찾기·내 코스)에서 골라 방에 보낸다.
// 아직 받지 않은 모두의 코스는 코스 탭 › 모두의 코스에서 먼저 받는다 — 고르는 목록을 하나로 두려고
import { useEffect, useState } from 'react';
import { filterCourses, type CourseFilter } from '../../app/courseFilter';
import { isFavorite, tagsOf, useCoursePrefs } from '../../app/coursePrefs';
import { loadCourses, useDrive } from '../../app/drive';
import { groupErrorText, isGroupHost, shareGroupCourse, useGroup } from '../../app/group';
import { ApiError } from '../../server/api';
import type { Course } from '../../types/course';
import { CourseThumb } from '../components/CourseThumb';
import { formatLength } from '../format';
import { IconBack } from '../icons';

const CHIPS: Array<{ id: CourseFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'builtin', label: '기본 코스' },
  { id: 'shared', label: '모두의 코스' },
  { id: 'fav', label: '즐겨찾기' },
  { id: 'mine', label: '내 코스' },
];

// 서버·통신 오류는 팀 주행 문구로, 폰에서 막은 까닭(100 km 등)은 그대로
const errorText = (e: unknown): string => (e instanceof ApiError || e instanceof TypeError || !(e instanceof Error) ? groupErrorText(e) : e.message);

export function GroupCourseScreen() {
  const g = useGroup();
  const { courses } = useDrive();
  const prefs = useCoursePrefs();
  const [filter, setFilter] = useState<CourseFilter>('all');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void loadCourses();
  }, []);
  const list = filterCourses(courses, filter, { isFavorite: (c) => isFavorite(c, prefs), tagsOf: (c) => tagsOf(c, prefs) }, null);
  const pick = (c: Course) => {
    setBusy(true);
    setNote(null);
    shareGroupCourse(c).then(
      () => {
        window.location.hash = '#/group';
      },
      (e: unknown) => {
        setNote(errorText(e));
        setBusy(false);
      },
    );
  };

  return (
    <main className="page" style={{ gap: 12 }}>
      <header className="page-head">
        <a className="back-btn" href="#/group" aria-label="뒤로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1 }}>코스 정하기</h1>
      </header>
      {!g.room ? (
        <div className="empty">들어가 있는 팀 주행이 없어요</div>
      ) : !isGroupHost(g) ? (
        <div className="notice">방장만 코스를 정할 수 있어요</div>
      ) : (
        <>
          <span className="sub">고른 코스를 팀원에게 보내요. 출발하면 각자 출발점까지 안내하고, 출발선부터 기록해요</span>
          <div className="browse-chips" role="group" aria-label="코스 분류">
            {CHIPS.map((f) => (
              <button key={f.id} type="button" className="browse-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.id === 'fav' && (
                  <span className="fav" aria-hidden="true">
                    ★
                  </span>
                )}
                {f.label}
              </button>
            ))}
          </div>
          {filter === 'shared' && <span className="sub">받아 둔 코스만 보여요. 코스 탭 › 모두의 코스에서 먼저 받아 주세요</span>}
          {note && (
            <div className="notice warn" role="status">
              {note}
            </div>
          )}
          {list.length === 0 ? (
            <span className="sub">이 분류에 코스가 없어요</span>
          ) : (
            <ul className="rows" aria-label="팀 방에 정할 코스">
              {list.map(({ course: c }) => (
                <li key={c.id} className="course-li">
                  <button type="button" className="row-card course-row" disabled={busy} onClick={() => pick(c)} style={{ width: '100%', textAlign: 'left' }}>
                    <CourseThumb course={c} />
                    <span className="card-col course-row-text">
                      <strong style={{ fontSize: 16 }}>{c.name}</strong>
                      <span className="sub">{`${c.kind === 'loop' ? '랩' : '편도'} · ${formatLength(c.lengthM)}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
