// 지도에서 새 코스 (사양서 7.5, 8.7): 이름과 종류를 정하고, 지도에서 출발선 위치 → 진행 방향을 차례로 누른다
// (편도는 도착선도). 코스 선은 첫 주행 뒤에 생긴다. 게이트 폭은 설정값.
import { useMemo, useState } from 'react';
import { createMapCourse, type GatePick } from '../../app/courses';
import type { LatLon } from '../../engine/geo';
import type { CourseKind } from '../../types/course';
import { PickMap } from '../components/PickMap';
import { useLocationPreview } from '../hooks/useLocationPreview';
import { IconBack } from '../icons';
import type { MapShape } from '../map/leafletMap';
import { PIN_LABEL } from '../map/courseStyle';

const STEPS = ['출발선 위치', '출발 방향', '도착선 위치', '도착 방향'] as const;

export function NewCourseScreen() {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CourseKind>('loop');
  const [picks, setPicks] = useState<LatLon[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { fix } = useLocationPreview(true);
  const need = kind === 'loop' ? 2 : 4;
  const step = picks.length < need ? STEPS[picks.length]! : null;

  const shapes = useMemo(() => {
    const s: MapShape[] = [];
    // 출발선·도착선 자리는 핀(출발 파랑 · 도착 빨강, 코스 지도와 같게), 진행 방향 점은 작은 흰 점
    picks.forEach((p, i) => {
      if (i % 2 === 1) {
        const a = picks[i - 1]!;
        s.push({ kind: 'line', pts: [[a.lat, a.lon], [p.lat, p.lon]], color: '#eceef0', weight: 3, dash: '6 4' });
        s.push({ kind: 'dot', at: [p.lat, p.lon], color: '#eceef0', r: 5 });
      }
    });
    picks.forEach((p, i) => {
      if (i % 2 === 0) s.push({ kind: 'pin', at: [p.lat, p.lon], which: i === 0 ? 'start' : 'finish', text: i === 0 ? PIN_LABEL.start : PIN_LABEL.finish });
    });
    if (fix) s.push({ kind: 'dot', at: [fix.lat, fix.lon], color: '#eceef0', r: 5 });
    return s;
  }, [picks, fix]);

  const save = async () => {
    setError(null);
    try {
      const g = (i: number): GatePick => ({ at: picks[i]!, toward: picks[i + 1]! });
      const c = await createMapCourse({ name, kind, start: g(0), finish: kind === 'point_to_point' ? g(2) : null });
      window.location.hash = `#/course/${c.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="page page-full">
      <header className="page-head">
        <a className="back-btn" href="#/courses" aria-label="코스로">
          <IconBack size={24} />
        </a>
        <h1>지도에서 새 코스</h1>
      </header>
      <label htmlFor="new-course-name" className="label">
        코스 이름
      </label>
      <input id="new-course-name" className="text-input" type="text" placeholder="예: 인제 풀코스" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <div className="segmented small" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="group" aria-label="코스 종류">
        {(
          [
            ['loop', '랩 코스'],
            ['point_to_point', '편도 구간'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setPicks((p) => p.slice(0, k === 'loop' ? 2 : 4));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="notice" role="status">
        {step ? `지도에서 ${step}를 누르세요 (${picks.length + 1}/${need})` : '다 찍었어요. 저장하면 첫 주행 뒤에 코스 선이 생겨요.'}
      </div>
      <PickMap
        shapes={shapes}
        fit={fix ? [[fix.lat, fix.lon]] : undefined}
        fitKey={fix ? 'fix' : 'none'}
        label="새 코스 지도: 출발선 위치와 방향을 누르세요"
        onPick={(lat, lon) => setPicks((p) => (p.length < need ? [...p, { lat, lon }] : p))}
      />
      {error && <div className="notice warn">{error}</div>}
      <div className="button-pair">
        <button type="button" className="btn" disabled={picks.length === 0} onClick={() => setPicks([])}>
          다시 찍기
        </button>
        <button type="button" className="btn btn-primary" disabled={picks.length < need} onClick={() => void save()}>
          저장
        </button>
      </div>
    </main>
  );
}
