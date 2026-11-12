// 코스 상세 (사양서 8.7): 지도(중심선·출발선·도착선·구간 경계), 이름 바꾸기, 출발선·도착선 옮기기(지도에서 누르기),
// 코스 다듬기, GPX 내보내기. 선을 옮기거나 다듬으면 버전이 올라가고 이 코스의 기록을 원본에서 다시 계산한다.
import { useEffect, useMemo, useState } from 'react';
import { courseGpxFile, moveCourseGate, recomputeCourse, refineCourseFromLaps, renameCourse, sectorMarks, sessionsOfCourse, validLapCount } from '../../app/courses';
import { loadCourses, useDrive } from '../../app/drive';
import { config } from '../../engine/config';
import { gateSegment } from '../../engine/course/geometry';
import { fromLocal, type LatLon } from '../../engine/geo';
import { shareOrDownload } from '../../storage/exportFile';
import type { Course } from '../../types/course';
import { PickMap } from '../components/PickMap';
import { Sheet } from '../components/Sheet';
import { formatLapTime, formatLength } from '../format';
import { IconBack } from '../icons';
import type { MapShape } from '../map/leafletMap';
import { useBestTimes } from './useBestTimes';

const SOURCE: Record<Course['source'], string> = { auto: '첫 주행으로 자동', map: '지도에서', gpx: 'GPX' };

export function courseShapes(c: Course, pending: LatLon | null): { shapes: MapShape[]; fit: Array<[number, number]> } {
  const shapes: MapShape[] = [];
  const fit: Array<[number, number]> = [];
  if (c.centerline && c.centerline.length >= 2) {
    const pts = c.kind === 'loop' ? [...c.centerline, c.centerline[0]!] : c.centerline;
    shapes.push({ kind: 'line', pts, color: '#eceef0', weight: 9, opacity: 0.2 });
    shapes.push({ kind: 'line', pts, color: '#c9cdd2', weight: 1.5 });
    fit.push(...c.centerline);
  }
  const gate = (g: Course['startGate'], text: string, dash?: string) => {
    const s = gateSegment(g, c.origin);
    const a = fromLocal(c.origin, s.ax, s.ay);
    const b = fromLocal(c.origin, s.bx, s.by);
    shapes.push({ kind: 'line', pts: [[a.lat, a.lon], [b.lat, b.lon]], color: '#aacae6', weight: 4, dash });
    const t = fromLocal(c.origin, s.cx - s.dx * 20, s.cy - s.dy * 20);
    shapes.push({ kind: 'label', at: [t.lat, t.lon], text });
    fit.push([g.lat, g.lon]);
  };
  gate(c.startGate, '출발');
  if (c.kind === 'point_to_point') gate(c.finishGate, '도착', '6 4');
  for (const m of sectorMarks(c)) {
    shapes.push({ kind: 'dot', at: [m.at.lat, m.at.lon], color: '#ffb224', r: 5 });
    shapes.push({ kind: 'label', at: [m.at.lat, m.at.lon], text: m.label });
  }
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
        {course.kind === 'loop' ? '랩' : '편도'} · {formatLength(course.lengthM)} · 버전 {course.version} · {SOURCE[course.source]}
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
      </div>

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
    </main>
  );
}
