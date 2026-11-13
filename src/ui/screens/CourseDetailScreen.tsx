// 코스 상세 (사양서 8.7): 지도(중심선·출발선·도착선·구간 경계), 이름 바꾸기, 출발선·도착선 옮기기(지도에서 누르기),
// 코스 다듬기, GPX 내보내기, 코스 지우기(내 코스만), 출발점·도착점을 내비 앱으로 열기. 선을 옮기거나 다듬으면 버전이 올라가고 이 코스의 기록을 원본에서 다시 계산한다.
import { useEffect, useMemo, useState } from 'react';
import { courseGpxFile, deleteCourse, makeReverseCourse, moveCourseGate, recomputeCourse, refineCourseFromLaps, renameCourse, sectorMarks, sessionsOfCourse, validLapCount } from '../../app/courses';
import { loadCourses, prepareWithCourse, startCoursePreview, useDrive } from '../../app/drive';
import { config } from '../../engine/config';
import { gateSegment } from '../../engine/course/geometry';
import { fromLocal, type LatLon } from '../../engine/geo';
import { shareOrDownload } from '../../storage/exportFile';
import type { Course } from '../../types/course';
import { Overlay } from '../components/Overlay';
import { PickMap } from '../components/PickMap';
import { Sheet } from '../components/Sheet';
import { formatLapTime, formatLength } from '../format';
import { IconBack } from '../icons';
import { PIN_LABEL } from '../map/courseStyle';
import type { MapShape } from '../map/leafletMap';
import { NAV_APP_LABEL, NAV_APP_WITH, navUrl, openNavApp, platformOf, storeUrl, type NavApp } from '../navLinks';
import { isApp } from '../../platform';
import { useBestTimes } from './useBestTimes';

/** 출발점·도착점을 네이버 지도·카카오맵으로 열기 (사용자 요청). 앱이 없으면 설치 화면 링크.
 *  아이폰 앱(사양서 13.3)에서는 버튼으로 바깥 내비 앱을 열고, 없으면 앱스토어 */
export function NavOpen({ course }: { course: Course }) {
  const platform = platformOf(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const appname = typeof window === 'undefined' ? 'gachitayo' : `${window.location.origin}${window.location.pathname}`;
  const loop = course.kind === 'loop';
  const points = [
    { label: loop ? '출발·도착점' : '출발점', at: course.startGate, name: `${course.name} ${loop ? '출발·도착' : '출발'}` },
    ...(loop ? [] : [{ label: '도착점', at: course.finishGate, name: `${course.name} 도착` }]),
  ];
  const apps: NavApp[] = ['naver', 'kakao'];
  return (
    <section className="card card-col nav-open" aria-label="내비로 가기">
      <span className="label">내비로 가기</span>
      {points.map((p) => (
        <div key={p.label} className="nav-open-row">
          <span className="nav-open-label">{p.label}</span>
          {apps.map((app) => {
            const point = { lat: p.at.lat, lon: p.at.lon, name: p.name };
            const label = `${p.label}까지 ${NAV_APP_WITH[app]} 길안내`;
            return isApp() ? (
              <button key={app} type="button" className="btn small" onClick={() => void openNavApp(app, point)} aria-label={label}>
                {NAV_APP_LABEL[app]}
              </button>
            ) : (
              <a key={app} className="btn small" href={navUrl(app, point, platform, appname)} aria-label={label}>
                {NAV_APP_LABEL[app]}
              </a>
            );
          })}
        </div>
      ))}
      <span className="sub">
        카카오맵은 길찾기 화면이 열려요. "안내 시작"을 누르면 길안내를 해요. 앱이 없으면 설치:{' '}
        {apps.map((app, i) => (
          <span key={app}>
            {i > 0 ? ' · ' : ''}
            <a href={storeUrl(app, platform)} target="_blank" rel="noreferrer">
              {NAV_APP_LABEL[app]}
            </a>
          </span>
        ))}
      </span>
    </section>
  );
}

const SOURCE: Record<Course['source'], string> = { auto: '첫 주행으로 자동', map: '지도에서', gpx: 'GPX' };

export function courseShapes(c: Course, pending: LatLon | null): { shapes: MapShape[]; fit: Array<[number, number]> } {
  const shapes: MapShape[] = [];
  const fit: Array<[number, number]> = [];
  // 사용자 요청 시안 2: 빨간 선 + 빛 번짐, 출발 파랑 핀 · 도착 빨강 핀 + 큰 글자, 구간 경계 큰 노랑
  if (c.centerline && c.centerline.length >= 2) {
    shapes.push({ kind: 'route', pts: c.kind === 'loop' ? [...c.centerline, c.centerline[0]!] : c.centerline });
    fit.push(...c.centerline);
  }
  const pins: MapShape[] = [];
  const gate = (g: Course['startGate'], which: 'start' | 'finish', text: string) => {
    const s = gateSegment(g, c.origin);
    const a = fromLocal(c.origin, s.ax, s.ay);
    const b = fromLocal(c.origin, s.bx, s.by);
    shapes.push({ kind: 'gate', a: [a.lat, a.lon], b: [b.lat, b.lon], which });
    pins.push({ kind: 'pin', at: [g.lat, g.lon], which, text });
    fit.push([g.lat, g.lon]);
  };
  gate(c.startGate, 'start', PIN_LABEL.start);
  if (c.kind === 'point_to_point') gate(c.finishGate, 'finish', PIN_LABEL.finish);
  for (const m of sectorMarks(c)) shapes.push({ kind: 'sector', at: [m.at.lat, m.at.lon], text: m.label });
  shapes.push(...pins);
  if (pending) shapes.push({ kind: 'dot', at: [pending.lat, pending.lon], color: '#aacae6', r: 8 });
  return { shapes, fit };
}

export function CourseDetailScreen({ courseId }: { courseId: string }) {
  const { courses } = useDrive();
  useEffect(() => {
    void loadCourses();
  }, []);
  const course = courses.find((c) => c.id === courseId) ?? null;
  const best = useBestTimes(course ? [course] : []);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'start' | 'finish' | null>(null);
  const [pending, setPending] = useState<LatLon | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [counts, setCounts] = useState<{ sessions: number; laps: number }>({ sessions: 0, laps: 0 });
  const [refineAsk, setRefineAsk] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!course) return;
    setName(course.name);
    let alive = true;
    void Promise.all([sessionsOfCourse(course.id), validLapCount(course)]).then(([s, l]) => alive && setCounts({ sessions: s.length, laps: l }));
    return () => {
      alive = false;
    };
  }, [course]);

  const map = useMemo(() => (course ? courseShapes(course, pending) : { shapes: [], fit: [] }), [course, pending]);

  if (!course) {
    return (
      <main className="page page-full">
        <div className="empty">코스를 찾을 수 없습니다.</div>
        <a className="primary-btn" href="#/courses">
          코스로
        </a>
      </main>
    );
  }

  const run = async (label: string, work: () => Promise<Course>) => {
    setBusy(label);
    setMsg(null);
    try {
      const c = await work();
      setBusy(`기록 다시 계산 중… (${counts.sessions}개)`);
      const r = await recomputeCourse(c.id, (d, t) => setBusy(`기록 다시 계산 중… ${d}/${t}`));
      setMsg({ text: `버전 ${c.version}으로 바꾸고 기록 ${r.done}개를 다시 계산했어요.${r.skipped ? ` ${r.skipped}개는 원본을 구하지 못해 다시 계산하지 못했어요 (통신 연결 후 다시).` : ''}` });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), warn: true });
    } finally {
      setBusy(null);
    }
  };

  const minLaps = config.course.refineMinLaps;
  return (
    <main className="page page-full">
      <header className="page-head">
        <a className="back-btn" href="#/courses" aria-label="코스로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{course.name}</h1>
      </header>
      <span className="sub" style={{ marginTop: -8 }}>
        {course.kind === 'loop' ? '랩' : '편도'} · {formatLength(course.lengthM)} · 버전 {course.version} · {course.builtin ? '기본 코스' : SOURCE[course.source]}
        {best[course.id] != null ? ` · 내 베스트 ${formatLapTime(best[course.id]!, 3)}` : ''} · 기록 {counts.sessions}개
      </span>

      <PickMap
        shapes={map.shapes}
        fit={map.fit}
        fitKey={`${course.id}:${course.version}`}
        label={mode ? `코스 지도: ${mode === 'start' ? '출발선' : '도착선'}을 옮길 곳을 누르세요` : '코스 지도: 중심선, 출발선, 구간 경계'}
        onPick={(lat, lon) => {
          if (mode) setPending({ lat, lon });
        }}
      />
      {!mode && (
        <button type="button" className="primary-btn" disabled={!!busy} onClick={() => prepareWithCourse(course)}>
          이 코스로 주행
        </button>
      )}
      {!mode && (
        // 코스 미리 보기 (사용자 요청, 사양서 8.7·10.2): 가상 차가 이 코스를 한 번 달린다. 코스 선이 없으면(첫 주행 전) 못 한다
        <button type="button" className="btn preview-btn" disabled={!!busy || !course.centerline} onClick={() => void startCoursePreview(course)}>
          모의주행 (코스 미리 보기)
        </button>
      )}
      {!mode && <NavOpen course={course} />}
      {mode ? (
        <div className="notice">
          {mode === 'start' ? '출발선' : '도착선'}을 옮길 곳을 지도에서 누르세요. 코스 선 위 가장 가까운 곳으로 붙어요.
          <button type="button" className="btn small" onClick={() => (setMode(null), setPending(null))}>
            취소
          </button>
        </div>
      ) : (
        !course.centerline && <div className="notice">지도로 만든 코스예요. 첫 주행을 마치면 코스 선이 생기고, 그 뒤에 선을 옮길 수 있어요.</div>
      )}
      {busy && (
        <div className="notice" role="status">
          {busy}
        </div>
      )}
      {msg && <div className={`notice${msg.warn ? ' warn' : ''}`}>{msg.text}</div>}

      <label htmlFor="course-name" className="label">
        코스 이름
      </label>
      <div className="name-row" style={{ marginTop: -6 }}>
        <input id="course-name" type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          disabled={!name.trim() || name.trim() === course.name || !!busy}
          onClick={() =>
            void renameCourse(course.id, name)
              .then(() => setMsg({ text: '이름을 바꿨어요' }))
              .catch((e: Error) => setMsg({ text: e.message, warn: true }))
          }
        >
          저장
        </button>
      </div>

      <div className="button-grid">
        <button type="button" className="btn" disabled={!course.centerline || !!busy} onClick={() => (setMode('start'), setPending(null))}>
          출발선 옮기기
        </button>
        {course.kind === 'point_to_point' && (
          <button type="button" className="btn" disabled={!course.centerline || !!busy} onClick={() => (setMode('finish'), setPending(null))}>
            도착선 옮기기
          </button>
        )}
        <button type="button" className="btn" disabled={counts.laps < minLaps || !!busy} onClick={() => setRefineAsk(true)}>
          코스 다듬기 {counts.laps < minLaps ? `(유효 랩 ${minLaps}개부터)` : ''}
        </button>
        <button type="button" className="btn" onClick={() => void shareOrDownload(courseGpxFile(course))}>
          GPX 내보내기
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() =>
            void makeReverseCourse(course.id)
              .then((r) => {
                setMsg({ text: r.created ? `${course.name}의 역방향 코스를 만들었어요. 기록은 방향마다 따로 쌓여요.` : '이미 있는 역방향 코스로 왔어요.' });
                window.location.hash = `#/course/${r.course.id}`;
              })
              .catch((e: Error) => setMsg({ text: e.message, warn: true }))
          }
        >
          역방향 코스
        </button>
      </div>
      {!course.builtin && (
        <button type="button" className="btn danger" disabled={!!busy} onClick={() => (setDeleteError(null), setDeleteAsk(true))}>
          코스 지우기
        </button>
      )}

      {pending && mode && (
        <Sheet title={`${mode === 'start' ? '출발선' : '도착선'}을 여기로 옮길까요?`} onClose={() => setPending(null)}>
          <p className="sub" style={{ lineHeight: 1.6 }}>
            코스 버전이 {course.version + 1}로 올라가고, 이 코스의 기록 {counts.sessions}개를 원본에서 다시 계산해요. 랩타임과 베스트가 바뀔 수 있어요.
          </p>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              const at = pending;
              const which = mode;
              setPending(null);
              setMode(null);
              void run('선 옮기는 중…', () => moveCourseGate(course.id, which, at));
            }}
          >
            옮기기
          </button>
        </Sheet>
      )}
      {refineAsk && (
        <Sheet title="코스 다듬기" onClose={() => setRefineAsk(false)}>
          <p className="sub" style={{ lineHeight: 1.6 }}>
            유효 랩 {counts.laps}개의 경로를 평균해 코스 선을 다시 만들어요. 버전이 {course.version + 1}로 올라가고 기록 {counts.sessions}개를 다시 계산해요.
          </p>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              setRefineAsk(false);
              void run('코스 다듬는 중…', () => refineCourseFromLaps(course.id));
            }}
          >
            다듬기
          </button>
        </Sheet>
      )}
      {deleteAsk && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="course-delete-title">
              <h2 id="course-delete-title">코스를 지울까요?</h2>
              <p>
                {counts.sessions > 0
                  ? `${course.name} 코스와 이 코스로 달린 기록 ${counts.sessions}개를 폰과 서버에서 모두 지워요. 되돌릴 수 없어요.`
                  : `${course.name} 코스를 폰과 서버에서 지워요. 되돌릴 수 없어요.`}
              </p>
              {deleteError && <div className="notice warn">{deleteError}</div>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn danger"
                  disabled={deleting}
                  onClick={() => {
                    setDeleting(true);
                    void deleteCourse(course.id)
                      .then(() => {
                        setDeleteAsk(false);
                        window.location.hash = '#/courses';
                      })
                      .catch((e: Error) => setDeleteError(e.message))
                      .finally(() => setDeleting(false));
                  }}
                >
                  지우기
                </button>
                <button type="button" className="btn" disabled={deleting} onClick={() => setDeleteAsk(false)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </main>
  );
}
