// 코스 탭 (사양서 8.7): 코스 목록(내 코스, 기본 코스) → 코스 상세. 지도에서 새 코스, GPX 불러오기(코스로 또는 주행 기록으로).
import { useEffect, useRef, useState } from 'react';
import { importGpx } from '../../app/courses';
import { builtinInfo } from '../../courses/builtin';
import type { Course } from '../../types/course';
import { CourseThumb } from '../components/CourseThumb';
import { loadCourses, useDrive } from '../../app/drive';
import { parseGpx, suggestedCourseName } from '../../gpx/parse';
import { Sheet } from '../components/Sheet';
import { Tabbed } from '../components/TabBar';
import { formatLapTime, formatLength } from '../format';
import { useBestTimes } from './useBestTimes';
import { CourseChips } from '../components/CourseChips';
import { SharedCourseList } from '../components/SharedCourseList';
import { filterCourses } from '../../app/courseFilter';
import { isFavorite, TAG_LABEL, tagsOf, toggleFavorite, useCoursePrefs } from '../../app/coursePrefs';
import { usePopular } from '../../app/popular';
import { updateSettings, useSettings } from '../../app/settings';

export function CoursesScreen() {
  const { courses } = useDrive();
  useEffect(() => {
    void loadCourses();
  }, []);
  const best = useBestTimes(courses);
  const mine = courses.filter((c) => !c.builtin);
  const builtins = courses.filter((c) => c.builtin);
  // 분류 칩 (코스 둘러보기 설계): 전체면 예전처럼 내 코스·기본 코스로 나누고, 고르면 그 코스만 (인기 도로는 달린 사람 많은 순)
  const settings = useSettings();
  const prefs = useCoursePrefs();
  const filter = settings.courseFilter;
  const popular = usePopular(settings.popularPeriod, filter === 'popular');
  const filtered = filterCourses(courses, filter, { isFavorite: (c) => isFavorite(c, prefs), tagsOf: (c) => tagsOf(c, prefs) }, popular.rows);
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
        <CourseChips
          filter={filter}
          period={settings.popularPeriod}
          onFilter={(f) => updateSettings({ courseFilter: f })}
          onPeriod={(p) => updateSettings({ popularPeriod: p })}
          sharedSort={settings.sharedSort}
          onSharedSort={(s) => updateSettings({ sharedSort: s })}
        />
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
        {filter === 'shared' ? (
          // 모두의 코스 (설계 2부, 시안 ⑦): 서버의 공개 코스 목록 (내 폰에 없는 것도)
          <section className="card-col" style={{ gap: 8 }} aria-label="모두의 코스">
            <SharedCourseList sort={settings.sharedSort} />
          </section>
        ) : courses.length === 0 ? (
          <div className="empty">
            아직 코스가 없어요.
            <br />
            주행을 시작하면 첫 주행으로 코스를 만들어요.
          </div>
        ) : filter !== 'all' ? (
          <section className="card-col" style={{ gap: 8 }} aria-label="고른 분류의 코스">
            {filter === 'popular' && popular.error && <div className="notice">{popular.error}</div>}
            {filter === 'popular' && !popular.rows && !popular.error ? (
              <span className="sub">불러오는 중…</span>
            ) : filtered.length === 0 ? (
              <span className="sub">{filter === 'popular' ? '이 기간에 달린 기록이 아직 없어요' : '이 분류에 코스가 없어요'}</span>
            ) : (
              <ul className="rows">
                {filtered.map(({ course: c, drivers }) => (
                  <CourseRow key={c.id} c={c} best={best[c.id]} drivers={drivers} />
                ))}
              </ul>
            )}
          </section>
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

function CourseRow({ c, best, drivers }: { c: Course; best: number | null | undefined; drivers?: number }) {
  const route = builtinInfo(c)?.route;
  const prefs = useCoursePrefs();
  const fav = isFavorite(c, prefs);
  const tags = tagsOf(c, prefs);
  return (
    <li className="course-li">
      <a className="row-card course-row" href={`#/course/${c.id}`}>
        <CourseThumb course={c} />
        <span className="card-col course-row-text">
          <strong style={{ fontSize: 16 }}>{c.name}</strong>
          <span className="sub">
            {c.kind === 'loop' ? '랩' : '편도'} · {formatLength(c.lengthM)}
          </span>
          {route && <span className="sub course-row-route">{route}</span>}
          {(tags.length > 0 || drivers !== undefined) && (
            <span className="course-tags">
              {drivers !== undefined && <span className="course-tag hot">{drivers}명</span>}
              {tags.map((t) => (
                <span key={t} className="course-tag">
                  {TAG_LABEL[t]}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="right card-col" style={{ alignItems: 'flex-end' }}>
          <span className="label">내 베스트</span>
          <span className="mono">{best != null ? formatLapTime(best, 3) : '—'}</span>
        </span>
      </a>
      {/* 즐겨찾기 (사용자 요청): 줄 오른쪽 별, 즐겨찾기면 보라 */}
      <button type="button" className={`fav-star${fav ? ' on' : ''}`} aria-label={`${c.name} 즐겨찾기`} aria-pressed={fav} onClick={() => toggleFavorite(c)}>
        {fav ? '★' : '☆'}
      </button>
    </li>
  );
}
