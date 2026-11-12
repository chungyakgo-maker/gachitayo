// 코스 탭 (사양서 8.7): 코스 목록(내 코스, 기본 코스) → 코스 상세. 지도에서 새 코스, GPX 불러오기(코스로 또는 주행 기록으로).
import { useEffect, useRef, useState } from 'react';
import { importGpx } from '../../app/courses';
import { builtinInfo } from '../../courses/builtin';
import type { Course } from '../../types/course';
import { CourseThumb } from '../components/CourseThumb';
import { loadCourses, useDrive } from '../../app/drive';
import { parseGpx, suggestedCourseName } from '../../gpx/parse';
import { Sheet } from '../components/Sheet';
import { IconChevron } from '../icons';
import { Tabbed } from '../components/TabBar';
import { formatLapTime, formatLength } from '../format';
import { useBestTimes } from './useBestTimes';

export function CoursesScreen() {
  const { courses } = useDrive();
  useEffect(() => {
    void loadCourses();
  }, []);
  const best = useBestTimes(courses);
  const mine = courses.filter((c) => !c.builtin);
  const builtins = courses.filter((c) => c.builtin);
  const file = useRef<HTMLInputElement>(null);
  const [gpx, setGpx] = useState<{ text: string; name: string; hasTime: boolean } | null>(null);
  const [gpxName, setGpxName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onFile = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    try {
      const text = await f.text();
      const g = parseGpx(text);
      const name = suggestedCourseName(g, f.name);
      setGpx({ text, name, hasTime: g.hasTime });
      setGpxName(name);
    } catch (e) {
      setError(`GPX를 읽지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const doImport = async (mode: 'course' | 'session') => {
    if (!gpx) return;
    try {
      const r = await importGpx(gpx.text, mode, gpxName);
      setGpx(null);
      window.location.hash = r.kind === 'course' ? `#/course/${r.course.id}` : `#/summary/${r.sessionId}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGpx(null);
    }
  };
  return (
    <Tabbed path="/courses">
      <main className="page">
        <header className="page-head">
          <h1 className="big">코스</h1>
        </header>
        <div className="button-pair">
          <a className="btn" href="#/course-new" style={{ textAlign: 'center', textDecoration: 'none' }}>
            지도에서 새 코스
          </a>
          <button type="button" className="btn" onClick={() => file.current?.click()}>
            GPX 불러오기
          </button>
        </div>
        <input ref={file} type="file" accept=".gpx,application/gpx+xml" hidden onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        {error && <div className="notice warn">{error}</div>}
        {courses.length === 0 ? (
          <div className="empty">
            아직 코스가 없어요.
            <br />
            주행을 시작하면 첫 주행으로 코스를 만들어요.
          </div>
        ) : (
          <>
            <section className="card-col" style={{ gap: 8 }} aria-label="내 코스">
              <span className="label">내 코스</span>
              {mine.length === 0 ? (
                <span className="sub">주행을 시작하면 첫 주행으로 내 코스를 만들어요.</span>
              ) : (
                <ul className="rows">
                  {mine.map((c) => (
                    <CourseRow key={c.id} c={c} best={best[c.id]} />
                  ))}
                </ul>
              )}
            </section>
            {builtins.length > 0 && (
              <section className="card-col" style={{ gap: 8 }} aria-label="기본 코스">
                <span className="label">기본 코스</span>
                <ul className="rows">
                  {builtins.map((c) => (
                    <CourseRow key={c.id} c={c} best={best[c.id]} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      {gpx && (
        <Sheet title="GPX 불러오기" onClose={() => setGpx(null)}>
          <label htmlFor="gpx-name" className="label">
            이름
          </label>
          <input id="gpx-name" className="text-input" type="text" value={gpxName} maxLength={40} onChange={(e) => setGpxName(e.target.value)} />
          <button type="button" className="primary-btn" onClick={() => void doImport('course')}>
            코스로 등록
          </button>
          {gpx.hasTime ? (
            <button type="button" className="btn" onClick={() => void doImport('session')}>
              주행 기록으로 가져오기 (GPS만)
            </button>
          ) : (
            <span className="sub">시간 정보가 없어 코스로만 등록할 수 있어요.</span>
          )}
        </Sheet>
      )}
    </Tabbed>
  );
}

function CourseRow({ c, best }: { c: Course; best: number | null | undefined }) {
  const route = builtinInfo(c)?.route;
  return (
    <li>
      <a className="row-card course-row" href={`#/course/${c.id}`}>
        <CourseThumb course={c} />
        <span className="card-col course-row-text">
          <strong style={{ fontSize: 16 }}>{c.name}</strong>
          <span className="sub">
            {c.kind === 'loop' ? '랩' : '편도'} · {formatLength(c.lengthM)}
          </span>
          {route && <span className="sub course-row-route">{route}</span>}
        </span>
        <span className="right card-col" style={{ alignItems: 'flex-end' }}>
          <span className="label">내 베스트</span>
          <span className="mono">{best != null ? formatLapTime(best, 3) : '—'}</span>
        </span>
        <IconChevron size={18} color="#9AA1A9" />
      </a>
    </li>
  );
}
