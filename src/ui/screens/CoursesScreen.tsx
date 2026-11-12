// 코스 탭 (사양서 8.7 중 목록). 선 옮기기·이름 바꾸기·GPX는 코스 관리(다음 단계)에서.
import { useEffect } from 'react';
import { loadCourses, useDrive } from '../../app/drive';
import { Tabbed } from '../components/TabBar';
import { formatLapTime, formatLength } from '../format';
import { useBestTimes } from './useBestTimes';

export function CoursesScreen() {
  const { courses } = useDrive();
  useEffect(() => {
    void loadCourses();
  }, []);
  const best = useBestTimes(courses);
  return (
    <Tabbed path="/courses">
      <main className="page">
        <header className="page-head">
          <h1 className="big">코스</h1>
        </header>
        {courses.length === 0 ? (
          <div className="empty">
            아직 코스가 없어요.
            <br />
            주행을 시작하면 첫 주행으로 코스를 만들어요.
          </div>
        ) : (
          <ul className="rows">
            {courses.map((c) => (
              <li key={c.id} className="row-card">
                <span className="card-col">
                  <strong style={{ fontSize: 16 }}>{c.name}</strong>
                  <span className="sub">
                    {c.kind === 'loop' ? '랩' : '편도'} · {formatLength(c.lengthM)}
                  </span>
                </span>
                <span className="right card-col" style={{ alignItems: 'flex-end' }}>
                  <span className="label">내 베스트</span>
                  <span className="mono">{best[c.id] != null ? formatLapTime(best[c.id]!, 3) : '—'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </Tabbed>
  );
}
