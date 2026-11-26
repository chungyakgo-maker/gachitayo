// 코스 만들기 (사양서 7.5, 8.7; 2026-11-26 세영 "지도에서 새코스 → 코스 만들기 … 출발지·목적지를 지도선택 + 검색 2번",
// 시안 docs/mock/2026-11-26-course-create.jpg). 두 가지:
// · 출발지·도착지로 (기본): 출발지 칸·도착지 칸을 따로 검색하거나 "지도에서 고르기"로 지도를 눌러 정하면 길찾기로 도로 선을 받아
//   바로 선이 있는 편도 코스를 만든다 (app/courses.ts createRouteCourse)
// · 지도에서 직접: 예전 그대로 이름과 종류를 정하고 지도에서 출발선 위치 → 진행 방향을 차례로 누른다 (편도는 도착선도).
//   코스 선은 첫 주행 뒤에 생긴다. 게이트 폭은 설정값.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createMapCourse, createRouteCourse, type GatePick } from '../../app/courses';
import { findPlaces, findRouteBetween, MAP_PICK_NAME, type Place, type RouteData } from '../../app/routeNav';
import { formatLength, formatTravelTime } from '../format';
import type { LatLon } from '../../engine/geo';
import type { CourseKind } from '../../types/course';
import { PickMap } from '../components/PickMap';
import { useLocationPreview } from '../hooks/useLocationPreview';
import { IconBack } from '../icons';
import type { MapShape } from '../map/leafletMap';
import { PIN_LABEL } from '../map/courseStyle';

const STEPS = ['출발선 위치', '출발 방향', '도착선 위치', '도착 방향'] as const;

/** 지도에서 직접 (예전 방식) */
function MapPickCourse({ name, onMode }: { name: string; onMode: ReactNode }) {
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
    <>
      {onMode}
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
    </>
  );
}

interface Spot {
  lat: number;
  lon: number;
  name: string;
  sub: string;
}
type Which = 'from' | 'to';
const WHICH_LABEL: Record<Which, string> = { from: '출발지', to: '도착지' };

/** 출발지·도착지 한 칸: 정했으면 이름(바꾸기), 아니면 검색 칸과 결과. "지도에서 고르기"는 칸마다 */
function SpotField({ which, spot, picking, onPickMode, onSet, onClear }: { which: Which; spot: Spot | null; picking: boolean; onPickMode: () => void; onSet: (s: Spot) => void; onClear: () => void }) {
  const label = WHICH_LABEL[which];
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await findPlaces(q);
      setResults(r);
      if (r.length === 0) setError('찾는 곳이 없어요. 지도에서 골라 보세요');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card-col" style={{ gap: 6 }}>
      <div className="spot-head">
        <span className="label">{label}</span>
        <button type="button" className="chip small" aria-label={`${label} 지도에서 고르기`} aria-pressed={picking} onClick={onPickMode}>
          지도에서 고르기
        </button>
      </div>
      {picking ? (
        <div className="notice" role="status">{`지도에서 ${label}를 누르세요`}</div>
      ) : spot ? (
        <button type="button" className="spot-chosen" aria-label={`${label}: ${spot.name} (바꾸기)`} onClick={onClear}>
          <span>
            <strong>{spot.name}</strong>
            {spot.sub && <span className="sub">{spot.sub}</span>}
          </span>
          <span className="sub">바꾸기</span>
        </button>
      ) : (
        <>
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input className="text-input" type="text" enterKeyHint="search" aria-label={`${label} 검색`} placeholder={which === 'from' ? '출발지 검색 (예: 가락재)' : '도착지 검색 (예: 느랏재)'} value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn btn-primary" aria-label={`${label} 찾기`} disabled={busy || !q.trim()}>
              검색
            </button>
          </form>
          {results && results.length > 0 && (
            <ul className="place-list">
              {results.map((r, i) => (
                <li key={i}>
                  <button type="button" onClick={() => onSet({ lat: r.lat, lon: r.lon, name: r.name, sub: r.address })}>
                    <strong>{r.name}</strong>
                    <span className="sub">{[r.category, r.address].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <div className="notice warn">{error}</div>}
        </>
      )}
    </div>
  );
}

/** 출발지·도착지로: 둘 다 정하면 길찾기 → 선·길이·시간 → 이 길로 코스 만들기 */
function RouteCourse({ name, onMode }: { name: string; onMode: ReactNode }) {
  const [from, setFrom] = useState<Spot | null>(null);
  const [to, setTo] = useState<Spot | null>(null);
  const [picking, setPicking] = useState<Which | null>(null);
  const [alt, setAlt] = useState(0);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { fix } = useLocationPreview(true);
  const ask = useRef(0);

  // 둘 다 정해지면(또는 바뀌면, 다른 길) 길을 다시 찾는다. 늦게 온 예전 답은 버린다
  useEffect(() => {
    setRoute(null);
    if (!from || !to) {
      setStatus('idle');
      return;
    }
    const n = ++ask.current;
    setStatus('loading');
    setError(null);
    findRouteBetween({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }, alt).then(
      (r) => {
        if (n !== ask.current) return;
        setRoute(r);
        setStatus('ready');
      },
      (e: unknown) => {
        if (n !== ask.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      },
    );
  }, [from, to, alt]);

  const set = (w: Which, s: Spot | null) => {
    setAlt(0);
    (w === 'from' ? setFrom : setTo)(s);
  };
  const shapes = useMemo(() => {
    const out: MapShape[] = [];
    if (route) out.push({ kind: 'line', pts: route.points.map(([a, b]) => [a, b] as [number, number]), color: '#ff5b4f', weight: 4 });
    if (from) out.push({ kind: 'pin', at: [from.lat, from.lon], which: 'start', text: PIN_LABEL.start });
    if (to) out.push({ kind: 'pin', at: [to.lat, to.lon], which: 'finish', text: PIN_LABEL.finish });
    if (fix && !from && !to) out.push({ kind: 'dot', at: [fix.lat, fix.lon], color: '#eceef0', r: 5 });
    return out;
  }, [route, from, to, fix]);
  const fit: Array<[number, number]> | undefined = route ? route.points : from || to ? [from, to].filter((x): x is Spot => !!x).map((x) => [x.lat, x.lon]) : fix ? [[fix.lat, fix.lon]] : undefined;
  const fitKey = route ? `r${route.distanceM}:${route.points.length}` : `${from?.lat},${from?.lon}|${to?.lat},${to?.lon}|${fix ? 'f' : ''}`;

  const save = async () => {
    if (!route || !from || !to) return;
    setSaving(true);
    setError(null);
    try {
      const c = await createRouteCourse({ name, from: from.name, to: to.name, route });
      window.location.hash = `#/course/${c.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {onMode}
      {(['from', 'to'] as const).map((w) => (
        <SpotField
          key={w}
          which={w}
          spot={w === 'from' ? from : to}
          picking={picking === w}
          onPickMode={() => setPicking((p) => (p === w ? null : w))}
          onSet={(s) => set(w, s)}
          onClear={() => set(w, null)}
        />
      ))}
      <PickMap
        shapes={shapes}
        fit={fit}
        fitKey={fitKey}
        label={picking ? `코스 만들기 지도: ${WHICH_LABEL[picking]}를 누르세요` : '코스 만들기 지도'}
        onPick={(lat, lon) => {
          // "지도에서 고르기"를 누른 칸만 지도를 눌러 정한다 (지도를 끌다 잘못 찍히지 않게)
          if (!picking) return;
          set(picking, { lat, lon, name: MAP_PICK_NAME, sub: `${lat.toFixed(4)}, ${lon.toFixed(4)}` });
          setPicking(null);
        }}
      />
      {status === 'loading' && <div className="notice" role="status">길을 찾는 중…</div>}
      {route && <span className="sub mono">{`편도 · ${formatLength(route.distanceM)} · ${formatTravelTime(route.durationS)}`}</span>}
      {error && <div className="notice warn">{error}</div>}
      {from && to && (
        <div className="button-pair">
          <button type="button" className="btn" disabled={status === 'loading'} onClick={() => setAlt((a) => a + 1)}>
            다른 길
          </button>
          <button
            type="button"
            className="btn"
            disabled={status === 'loading'}
            onClick={() => {
              setAlt(0);
              setFrom(to);
              setTo(from);
            }}
          >
            출발↔도착
          </button>
        </div>
      )}
      <button type="button" className="btn btn-primary" disabled={!route || saving} onClick={() => void save()}>
        이 길로 코스 만들기
      </button>
    </>
  );
}

export function NewCourseScreen() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'route' | 'map'>('route');
  const modes = (
    <div className="segmented small" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="group" aria-label="만드는 방법">
      <button type="button" aria-pressed={mode === 'route'} onClick={() => setMode('route')}>
        출발지·도착지로
      </button>
      <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>
        지도에서 직접
      </button>
    </div>
  );
  return (
    <main className="page page-full">
      <header className="page-head">
        <a className="back-btn" href="#/courses" aria-label="코스로">
          <IconBack size={24} />
        </a>
        <h1>코스 만들기</h1>
      </header>
      <label htmlFor="new-course-name" className="label">
        코스 이름
      </label>
      <input id="new-course-name" className="text-input" type="text" placeholder={mode === 'route' ? '비우면 출발지 → 도착지' : '예: 인제 풀코스'} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      {mode === 'route' ? <RouteCourse name={name} onMode={modes} /> : <MapPickCourse name={name} onMode={modes} />}
    </main>
  );
}
