// 목적지 고르기 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.4, 사용자 결정 "지도 찍기 + 코스 목록"):
// 지도 전체 + 위·아래 얹은 카드. 장소 이름·주소를 검색하거나(네이버 지역 검색, 사용자 요청 "'만항재' 검색하면 나와야"), 지도를 길게 눌러 찍거나,
// 최근 목적지·코스 출발점/도착점(가까운 순)을 고르면 네이버 길찾기 경로를 받는다.
// 경로를 받으면 길이·시간·커브 수를 보여 주고 "이 경로로 출발" (그 탭에서 주행 준비를 연다: 아이폰 모션 권한).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { loadCourses, useDrive } from '../../app/drive';
import { clearPlan, courseDestinations, findPlaces, MAP_PICK_NAME, planTo, recentDestinations, setRecord, startRouteDrive, clearHandedDestination, peekHandedDestination, usePlan, type Destination, type Place } from '../../app/routeNav';
import { toLocal } from '../../engine/geo';
import { RouteGuide } from '../../engine/route/routeGuide';
import type { GpsState } from '../components/GpsIcon';
import { MainMap } from '../components/MainMap';
import { formatLength } from '../format';
import { useLocationPreview } from '../hooks/useLocationPreview';
import { useOverlayInsets } from '../hooks/useOverlayInsets';
import { IconBack } from '../icons';

/** 걸리는 시간: 1시간 미만은 분, 넘으면 시간·분 */
function travelTime(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

const distFrom = (from: { lat: number; lon: number } | null, d: { lat: number; lon: number }) => {
  if (!from) return null;
  const p = toLocal(from, d.lat, d.lon);
  return Math.hypot(p.x, p.y);
};

function PlaceButton({ d, distanceM, detail, onPick }: { d: Destination; distanceM: number | null; detail?: string; onPick: (d: Destination) => void }) {
  const dist = distanceM === null ? '' : formatLength(distanceM);
  return (
    <button type="button" className="sheet-item" aria-label={[d.name, detail, dist].filter(Boolean).join(' · ')} onClick={() => onPick(d)}>
      <span className="card-col dest-name">
        <strong className="dest-name">{d.name}</strong>
        {detail && <span className="sub dest-name">{detail}</span>}
      </span>
      {dist && <span className="sub mono">{dist}</span>}
    </button>
  );
}

type Search = { status: 'idle' } | { status: 'loading' } | { status: 'done'; places: Place[] } | { status: 'error'; error: string };

export function DestinationScreen() {
  const drive = useDrive();
  const plan = usePlan();
  // 지금 위치가 있어야 경로를 받으므로 허용 전이어도 위치를 켠다 (아이폰은 허용해도 "prompt"로 알려 주는 경우가 많다)
  const { fix, permission } = useLocationPreview(true, true);
  useEffect(() => {
    void loadCourses();
    // 화면을 떠나면 고르던 것을 지운다 (출발했으면 경로 안내가 따로 들고 있다)
    return () => clearPlan(true);
  }, []);
  const lat = fix?.lat ?? null;
  const lon = fix?.lon ?? null;
  const from = useMemo(() => (lat !== null && lon !== null ? { lat, lon } : null), [lat, lon]);
  // 고를 때마다 최근 목적지가 바뀔 수 있어 계획 상태가 바뀌면 다시 읽는다
  const recent = useMemo(() => recentDestinations(), [plan.status]);
  const courses = useMemo(() => courseDestinations(drive.courses, from), [drive.courses, from]);
  // 위치를 아직 못 받았으면 고른 곳을 들고 있다가 위치가 오면 바로 경로를 찾는다 (사용자 보고: 검색 결과를 눌러도 반응이 없었다)
  // 메인 검색 결과·코스 창에서 넘겨받은 목적지는 열자마자 (위치가 오면) 경로를 찾는다
  const [waiting, setWaiting] = useState<Destination | null>(() => peekHandedDestination());
  useEffect(() => clearHandedDestination(), []);
  const pick = (d: Destination) => {
    if (from) void planTo(d, from);
    else setWaiting(d);
  };
  useEffect(() => {
    if (!waiting || !from) return;
    void planTo(waiting, from);
    setWaiting(null);
  }, [waiting, from]);
  // 장소 검색 (늦게 온 결과는 버린다)
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ status: 'idle' });
  const searchSeq = useRef(0);
  const onSearch = (e?: FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    const seq = ++searchSeq.current;
    setSearch({ status: 'loading' });
    findPlaces(q).then(
      (places) => seq === searchSeq.current && setSearch({ status: 'done', places }),
      (err: unknown) => seq === searchSeq.current && setSearch({ status: 'error', error: err instanceof Error ? err.message : String(err) }),
    );
  };
  const clearSearch = () => {
    searchSeq.current++;
    setQuery('');
    setSearch({ status: 'idle' });
  };
  const route = plan.status === 'ready' ? plan.route : null;
  const curves = useMemo(() => (route && route.points.length >= 2 ? new RouteGuide(route.points, { lat: route.points[0]![0], lon: route.points[0]![1] }).notes.length : 0), [route]);
  const destLat = plan.dest?.lat ?? null;
  const destLon = plan.dest?.lon ?? null;
  const destPin = useMemo(() => (destLat !== null && destLon !== null ? { lat: destLat, lon: destLon } : null), [destLat, destLon]);

  const baseRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const ins = useOverlayInsets(baseRef, topRef, bottomRef);
  // 이미 주행·기록 중이면 새로 출발하지 않는다 (메인 화면과 같은 안내)
  const busy = drive.phase !== 'idle' && !drive.replay;
  const gps: GpsState = permission === 'denied' ? 'weak' : !fix ? 'none' : fix.hAcc <= 10 ? 'good' : fix.hAcc <= 30 ? 'wait' : 'weak';

  let bottom;
  if (waiting && plan.status === 'idle') {
    bottom = (
      <div className="card card-col dest-card" role="status">
        <strong className="dest-title">{waiting.name}</strong>
        <span className="sub">
          {permission === 'denied' ? '위치 권한이 꺼져 있어요. 설정에서 허용해 주세요' : '현재 위치를 받는 중… 받으면 바로 경로를 찾아요'}
        </span>
        <button type="button" className="ghost-btn" onClick={() => setWaiting(null)}>
          취소
        </button>
      </div>
    );
  } else if (plan.status === 'loading') {
    bottom = (
      <div className="card card-col dest-card" role="status">
        <strong>경로 찾는 중…</strong>
        <span className="sub">{plan.dest?.name}</span>
      </div>
    );
  } else if (plan.status === 'ready' && route && plan.dest) {
    bottom = (
      <div className="card card-col dest-card">
        <strong className="dest-title">{plan.dest.name}</strong>
        <span className="sub mono">{`${formatLength(route.distanceM)} · ${travelTime(route.durationS)} · 커브 ${curves}개`}</span>
        <button type="button" className="sheet-item" aria-pressed={plan.record} onClick={() => setRecord(!plan.record)}>
          <span className="card-col">
            <strong>기록 남기기 {plan.record ? '켜짐' : '꺼짐'}</strong>
            <span className="sub">{plan.record ? '끝나면 기록이 남고 코스로 저장할 수 있어요' : '끝나도 기록을 남기지 않아요'}</span>
          </span>
        </button>
        <div className="dest-actions">
          <button type="button" className="ghost-btn" onClick={() => clearPlan()}>
            다시 고르기
          </button>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => startRouteDrive()}>
            이 경로로 출발
          </button>
        </div>
      </div>
    );
  } else if (plan.status === 'error' && plan.dest) {
    const dest = plan.dest;
    bottom = (
      <div className="card card-col dest-card">
        <strong className="dest-title">{dest.name}</strong>
        <span className="notice warn">{plan.error}</span>
        <div className="dest-actions">
          <button type="button" className="ghost-btn" onClick={() => clearPlan()}>
            다시 고르기
          </button>
          <button type="button" className="primary-btn" onClick={() => pick(dest)}>
            다시 시도
          </button>
        </div>
      </div>
    );
  } else if (search.status !== 'idle') {
    bottom = (
      <div className="card card-col dest-card dest-list">
        <div className="card-row">
          <span className="label">검색 결과</span>
          <button type="button" className="link-btn" onClick={clearSearch}>
            검색 지우기
          </button>
        </div>
        {!from && <span className="sub">{permission === 'denied' ? '위치 권한이 꺼져 있어요. 설정에서 허용해 주세요' : '위치 확인 중'}</span>}
        {search.status === 'loading' && <span className="sub" role="status">찾는 중…</span>}
        {search.status === 'error' && <span className="notice warn">{search.error}</span>}
        {search.status === 'done' && search.places.length === 0 && <span className="sub">검색 결과가 없어요</span>}
        {search.status === 'done' &&
          search.places.map((p, i) => (
            <PlaceButton
              key={`s${i}`}
              d={{ lat: p.lat, lon: p.lon, name: p.name, kind: 'search' }}
              detail={[p.category, p.address].filter(Boolean).join(' · ')}
              distanceM={distFrom(from, p)}
              onPick={pick}
            />
          ))}
      </div>
    );
  } else {
    bottom = (
      <div className="card card-col dest-card dest-list">
        {!from && <span className="sub">{permission === 'denied' ? '위치 권한이 꺼져 있어요. 설정에서 허용해 주세요' : '위치 확인 중'}</span>}
        {recent.length > 0 && (
          <>
            <span className="label">최근 목적지</span>
            {recent.map((d, i) => (
              <PlaceButton key={`r${i}`} d={d} distanceM={distFrom(from, d)} onPick={pick} />
            ))}
          </>
        )}
        {courses.length > 0 && (
          <>
            <span className="label">코스 출발점 · 도착점</span>
            {courses.map(({ distanceM, ...d }, i) => (
              <PlaceButton key={`c${i}`} d={d} distanceM={distanceM} onPick={pick} />
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="dest-screen">
      <div className="main-full" ref={baseRef}>
        <div className="main-top overlay" ref={topRef}>
          <div className="card card-row dest-head">
            <a className="back-btn" href="#/" aria-label="뒤로" onClick={() => clearPlan(true)}>
              <IconBack size={24} />
            </a>
            <div className="card-col" style={{ flex: 1, minWidth: 0 }}>
              <span className="title">목적지 고르기</span>
              <span className="sub">장소를 검색하거나 지도를 길게 눌러 찍어요</span>
            </div>
          </div>
          <form className="card card-row dest-search" role="search" onSubmit={onSearch}>
            <input
              className="text-input"
              type="search"
              aria-label="장소 검색"
              placeholder="장소·주소 (예: 만항재)"
              enterKeyHint="search"
              maxLength={60}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="primary-btn dest-search-btn">
              검색
            </button>
          </form>
          {busy && (
            <a className="notice warn" href={drive.phase === 'preparing' ? '#/prepare' : '#/drive'} style={{ textDecoration: 'none' }}>
              진행 중인 주행이 있어요 · 돌아가기
            </a>
          )}
        </div>
        <MainMap
          course={null}
          courses={drive.courses}
          me={fix}
          label="지도: 목적지 고르기, 길게 눌러 목적지"
          insetTop={ins.top}
          insetBottom={ins.bottom}
          gps={gps}
          gpsAcc={fix?.hAcc ?? null}
          route={route ? route.points : null}
          dest={destPin}
          onLongPress={(la, lo) => pick({ lat: la, lon: lo, name: MAP_PICK_NAME, kind: 'map' })}
        />
        <div className="dest-bottom" ref={bottomRef}>
          {bottom}
        </div>
      </div>
    </div>
  );
}
