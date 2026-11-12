// 주행 화면 (사양서 8.4, 디자인 시안 DriveMap·DriveMinimal·DriveDashboard)
// 두 번 탭하면 모드 전환(지도 → 미니멀 → 대시보드), 2초 길게 눌러 종료. 그 밖의 터치는 무시한다.
// 지도 모드의 델타·고른 값·미니맵은 오버레이 그리기 함수(src/ui/overlay)로 캔버스에 그린다 (사양서 13.1 확장 지점).
import { useEffect, useMemo, useRef } from 'react';
import { useAccount } from '../../app/account';
import { useFriends, watchFriendPositions } from '../../app/friends';
import { useFollow, VIRTUAL_FRIEND, type FollowState } from '../../app/liveLink';
import { toLocal } from '../../engine/geo';
import { GapTracker } from '../../engine/live/gap';
import { FriendMarker, type FriendRoad } from '../../engine/live/friendMotion';
import { makePolyline } from '../../engine/course/polyline';
import { cycleDriveMode, endDrive, useDrive, useLiveSnapshot, type DriveState } from '../../app/drive';
import { updateSettings, useSettings, type DriveMode, type MapViewMode, type Settings, type WidgetId } from '../../app/settings';
import type { LiveSnapshot } from '../../engine/live/livePipeline';
import type { Course } from '../../types/course';
import type { RefLapRecord } from '../../types/drive';
import { GMeter } from '../components/GMeter';
import { LongPressButton } from '../components/LongPressButton';
import { OverlayCanvas } from '../components/OverlayCanvas';
import { LiveMap } from '../components/LiveMap';
import { MapViewButton } from '../components/MapViewButton';
import { GpsIcon, type GpsState } from '../components/GpsIcon';
import { useOverlayInsets } from '../hooks/useOverlayInsets';
import { GTrailBuffer } from '../overlay/gmeter';
import { formatDelta, formatLapTime } from '../format';
import { drawDeltaPanel, drawGTile, drawValueTile, gMeterLabel } from '../overlay/draw';
import { frameFromLive, headline, widgetValue, type GapInfo, type OverlayFrame } from '../overlay/frame';
import { mapModel } from '../overlay/minimap';
import { useSmoothAngle } from '../hooks/useSmoothView';
import { overlayTheme, type OverlayTheme } from '../overlay/theme';

export interface DriveViewProps {
  snap: LiveSnapshot | null;
  /** 앞 친구 간격 (M9). 없으면 끔 */
  gap?: GapInfo | null;
  /** 앞 친구 위치 (같은 평면 좌표) */
  front?: { x: number; y: number; label: string } | null;
  /** 위치를 공유 중인 다른 친구들 (같은 평면 좌표, 사용자 요청 "주행 중에도 위치 공유") */
  friends?: ReadonlyArray<{ x: number; y: number; label: string }>;
  course: Course | null;
  refLap: RefLapRecord | null;
  mode: DriveMode;
  settings: Settings;
  replay: DriveState['replay'];
  error: string | null;
  onCycle: () => void;
  onEnd: () => void;
  /** 주행 중 지도 보기 바꾸기 (사용자 요청). 기본: 설정에 저장 */
  onMapView?: (v: MapViewMode) => void;
}

const DOUBLE_TAP_MS = 350;
const LAP_FLASH_MS = 3000;

const deltaClass = (d: number | null) => (d === null ? '' : d < 0 ? 'fast' : d > 0 ? 'slow' : '');
const kmh = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v)));

/** 섹터 시간: 1분 미만이면 41.803, 넘으면 1:02.345 */
function sectorTime(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 60_000 ? (Math.floor(ms) / 1000).toFixed(3) : formatLapTime(ms, 3);
}

/** GPS 아이콘 색 (사용자 요청: 아래 상태 줄 대신 아이콘 색만). 끊기거나 약하면 빨강, 준비 전이면 노랑 */
export function gpsStateOf(snap: LiveSnapshot | null): GpsState {
  if (!snap) return 'none';
  if (snap.state?.status.gpsWeak || (snap.gps.ageMs ?? Infinity) > 3000) return 'weak';
  return snap.gps.ready ? 'good' : 'wait';
}

/** 지도 모드 상단의 고른 값 한 칸 (캔버스) */
function WidgetCanvas({ id, frame, th }: { id: WidgetId; frame: OverlayFrame; th: OverlayTheme }) {
  if (id === 'g') {
    return <OverlayCanvas className="tile g" label={gMeterLabel(frame)} draw={(ctx, w, h) => drawGTile(ctx, w, h, frame, th)} />;
  }
  const v = widgetValue(id, frame);
  return <OverlayCanvas className="tile" label={`${v.label} ${v.value}${v.unit ? ` ${v.unit}` : ''}`} draw={(ctx, w, h) => drawValueTile(ctx, w, h, v, th)} />;
}

export function DriveView({ snap, gap = null, front = null, friends = [], course, refLap, mode, settings, replay, error, onCycle, onEnd, onMapView = (v) => updateSettings({ mapView: v }) }: DriveViewProps) {
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  // 지도 모드: 위에 얹은 칸들이 지도를 가리는 높이 (다른 모드에서는 0)
  const mapRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const ins = useOverlayInsets(mapRef, padRef, bottomRef);
  const st = snap?.state ?? null;
  // 최근 G 궤적 (사용자 요청: 부드럽게 그린다). 스냅숏 시각 순서로 모은다
  const trailBuf = useRef(new GTrailBuffer());
  trailBuf.current.push(snap?.t ?? 0, st?.gx ?? null, st?.gy ?? null);
  const frame: OverlayFrame = { ...frameFromLive(snap, course !== null, refLap !== null), gap, gMax: settings.gMaxG, gTrail: trailBuf.current.points() };
  const hl = headline(frame);
  const h = { label: hl.label, text: hl.text, word: hl.word, cls: hl.tone === 'none' ? '' : hl.tone };
  const th = useMemo(() => overlayTheme(settings.deltaPalette), [settings.deltaPalette]);
  // 나침반 바늘용 진행 방향 (지도 자체는 LiveMap이 매 프레임 부드럽게 돌린다. 훅은 모드와 관계없이 늘 부른다)
  const headSm = useSmoothAngle(snap?.pos?.psi);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.end-btn, .map-compass')) return;
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 40) {
      lastTap.current = null;
      onCycle();
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
  };

  const end = (tall: boolean) => (
    <>
      {error && <div className="notice warn">{error}</div>}
      <LongPressButton tall={tall} onDone={onEnd} label={replay ? '길게 눌러 재생 끝내기' : '길게 눌러 종료'} />
    </>
  );
  const lapNo = st && st.lapNo > 0 ? st.lapNo : null;
  const lastLap = st?.lastLap ?? null;
  const flash = lastLap && st && st.t - lastLap.t < LAP_FLASH_MS ? lastLap : null;

  if (mode === 'minimal') {
    return (
      <div className="drive mode-minimal" onPointerDown={onPointerDown} data-testid="drive">
        <div className="drive-pad wide">
          <div className="minimal-top">
            <div className="card-col" style={{ gap: 2 }}>
              <span className="label" style={{ fontSize: 13 }}>
                랩
              </span>
              <span className="big-num">{lapNo ?? '—'}</span>
            </div>
            <div className="card-col" style={{ gap: 2, alignItems: 'flex-end' }}>
              <span className="label" style={{ fontSize: 13 }}>
                {course ? '현재 랩' : '출발 뒤'}
              </span>
              <span className="big-num">{formatLapTime(st?.lapElapsedMs ?? null, 1)}</span>
            </div>
          </div>
          <div className={`minimal-panel delta-panel ${flash ? '' : h.cls}`}>
            {flash ? (
              <>
                <span style={{ fontSize: 18, color: 'var(--fg-2)' }}>랩 {flash.lapNo} 완료</span>
                <span className="lap-flash">{formatLapTime(flash.timeMs, 3)}</span>
                {refLap && flash.valid && flash.timeMs < refLap.lapTimeMs && (
                  <span className="pill fast" style={{ alignSelf: 'center', fontSize: 16, padding: '8px 14px' }}>
                    새 베스트 <span className="mono">{formatDelta((flash.timeMs - refLap.lapTimeMs) / 1000, 3)}</span>
                  </span>
                )}
                {!flash.valid && <span className="dim">무효 랩</span>}
              </>
            ) : !course ? (
              <>
                <span style={{ fontSize: 16, color: 'var(--fg-2)' }}>코스 기록 중</span>
                <span className="delta-text" style={{ color: 'var(--fg)' }}>
                  {kmh(st?.speedKmh ?? null)}
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-dim)' }}>km/h</span>
                <span style={{ marginTop: 12, fontSize: 13 }} className="dim">
                  랩은 주행이 끝난 뒤 계산해요
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 16, color: 'var(--fg-2)' }}>{h.label}</span>
                <span className="delta-text">{h.text}</span>
                <span className={`delta-word ${h.cls}`} style={{ fontSize: 20, fontWeight: 700 }}>
                  {h.word}
                </span>
                {refLap && (
                  <span style={{ marginTop: 12, fontSize: 13 }} className="dim">
                    비교 <span className="mono">{formatLapTime(refLap.lapTimeMs, 3)}</span> · 내 베스트
                  </span>
                )}
              </>
            )}
          </div>
          <div className="gps-row">
            <GpsIcon state={gpsStateOf(snap)} hAcc={snap?.gps.hAcc} />
          </div>
          {end(true)}
        </div>
      </div>
    );
  }

  if (mode === 'dashboard') {
    const best = [st?.bestLapMs ?? null, refLap?.lapTimeMs ?? null].filter((v): v is number => v !== null);
    return (
      <div className="drive mode-dashboard" onPointerDown={onPointerDown} data-testid="drive">
        <div className="drive-pad wide dash">
          <div className={`dash-delta delta-panel full ${h.cls}`}>
            <div className="card-col" style={{ gap: 6 }}>
              <span style={{ fontSize: 14, color: 'var(--fg-2)' }}>{h.label}</span>
              <span className={`delta-word ${h.cls}`} style={{ fontSize: 20, fontWeight: 700 }}>
                {h.word}
              </span>
            </div>
            <span className="delta-text" style={!course ? { color: 'var(--fg)', fontSize: 'min(64px, 16vw)' } : undefined}>
              {h.text}
            </span>
          </div>
          <div className="dash-grid full">
            <div className="dash-tile">
              <span style={{ fontSize: 13 }} className="dim">
                속도
              </span>
              <span className="speed">{kmh(st?.speedKmh ?? null)}</span>
              <span style={{ fontSize: 14 }} className="dim">
                km/h
              </span>
            </div>
            {/* G: 글자 없이 칸을 꽉 채운 G미터 (사용자 요청) */}
            <div className="dash-tile g-tile">
              <GMeter gx={st?.gx ?? null} gy={st?.gy ?? null} max={settings.gMaxG} trail={frame.gTrail} estimated={st?.gEstimated ?? false} />
            </div>
          </div>
          <div className="dash-laps full">
            <div className="card-col">
              <span className="label">랩</span>
              <span className="v">{lapNo ?? '—'}</span>
            </div>
            <div className="card-col">
              <span className="label">{course ? '현재 랩' : '출발 뒤'}</span>
              <span className="v">{formatLapTime(st?.lapElapsedMs ?? null, 1)}</span>
            </div>
            <div className="card-col">
              <span className="label">베스트</span>
              <span className="v">{best.length ? formatLapTime(Math.min(...best), 3) : '—'}</span>
            </div>
          </div>
          <div className="sectors full">
            {[0, 1, 2].map((i) => {
              const cur = st?.currentSector === i;
              const done = st?.currentSector != null && i < st.currentSector;
              const d = st?.sectorDeltas[i] ?? null;
              return (
                <div key={i} className={`sector${cur ? ' current' : ''}`}>
                  <span className="label" style={cur ? { color: 'var(--fg)', fontWeight: 600 } : undefined}>
                    구간 {i + 1}
                  </span>
                  {done ? (
                    <span className="sector-time">{sectorTime(st?.sectorTimesMs[i] ?? null)}</span>
                  ) : cur ? (
                    <span style={{ fontSize: 16, color: 'var(--fg-2)' }}>진행 중</span>
                  ) : (
                    <span className="sector-time" style={{ color: 'var(--fg-off)' }}>
                      —
                    </span>
                  )}
                  <span className={`sector-delta ${deltaClass(d)}`}>{done || cur ? formatDelta(d) : '—'}</span>
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div className="full">
            <div className="gps-row">
              <GpsIcon state={gpsStateOf(snap)} hAcc={snap?.gps.hAcc} />
            </div>
            {end(true)}
          </div>
        </div>
      </div>
    );
  }

  // 지도 모드: 델타·고른 값·미니맵은 캔버스 (겉모습은 시안 그대로)
  const lapText = lapNo ? `랩 ${lapNo}` : '랩';
  const deltaLabel = `${h.label}${h.word ? ` · ${h.word}` : ''} ${h.text}${course ? `, ${lapText} ${formatLapTime(st?.lapElapsedMs ?? null, 1)}` : ''}`;
  const model = mapModel(course);
  const mapLabel = frame.ghost ? '코스 지도: 내 위치와 베스트 고스트' : '코스 지도: 내 위치';
  const me = frame.me;
  const mapView = settings.mapView;
  const headPsi = headSm ?? me?.psi ?? null;
  const mapRot = mapView === 'heading' && me && headPsi !== null ? Math.PI / 2 - headPsi : 0;
  return (
    // 지도가 화면 전체, 델타·고른 값·종료 버튼은 위에 얹는다. 내 위치는 가려지지 않은 영역의 가운데 (사용자 요청)
    <div className="drive mode-map" onPointerDown={onPointerDown} data-testid="drive">
      <div className="drive-map" ref={mapRef}>
        {/* 지도는 화면 주사율로 따로 그린다 (사용자 요청 "지도가 뚝뚝 끊긴다"). 바탕 지도(OSM)는 설정으로 끔, 통신이 없으면 타일 없이 */}
        <LiveMap
          model={model}
          frame={frame}
          origin={snap?.origin ?? null}
          th={th}
          insetTop={ins.top}
          insetBottom={ins.bottom}
          label={mapLabel}
          friend={front}
          friends={friends}
          view={mapView}
          tiles={replay !== null || settings.mapTiles}
          speedKmh={st?.speedKmh ?? null}
        />
        {/* 왼쪽 위 나침반(지도 보기), 오른쪽 위 GPS 아이콘: 가려지지 않은 지도의 위 모서리 */}
        <MapViewButton view={mapView} rot={mapRot} onChange={onMapView} style={{ top: ins.top + 10 }} />
        <GpsIcon className="gps-icon map-gps" style={{ top: ins.top + 13 }} state={gpsStateOf(snap)} hAcc={snap?.gps.hAcc} />
        <div className="drive-bottom" ref={bottomRef}>
          {end(false)}
        </div>
      </div>
      <div className="drive-pad" ref={padRef}>
        <OverlayCanvas
          className={`delta-panel delta-map ${h.cls}`}
          label={deltaLabel}
          draw={(ctx, w, hh) => drawDeltaPanel(ctx, w, hh, frame, th, { deltaPx: hh >= 104 ? 64 : 48 })}
        />
        <div className="widget-row">
          <WidgetCanvas id={settings.widgets[0]} frame={frame} th={th} />
          <WidgetCanvas id={settings.widgets[1]} frame={frame} th={th} />
        </div>
      </div>
    </div>
  );
}

/** 받은 앞 친구 위치로 간격을 계산한다 (그릴 때마다, 1초 동안 부드럽게) */
export function useFrontGap(snap: LiveSnapshot | null, follow: FollowState, targetS: number, course: Course | null = null): { gap: GapInfo | null; front: DriveViewProps['front'] } {
  const tracker = useRef(new GapTracker());
  // 친구 아이콘: 받은 마지막 위치에서 일정 속도로 도로(코스 선)를 따라 지금 위치를 예측하고, 새 위치가 와도 튀지 않게 (사용자 요청)
  const marker = useRef(new FriendMarker());
  const fed = useRef<{ key: string; n: number; lastT: number }>({ key: '', n: 0, lastT: 0 });
  const road = useMemo<FriendRoad | null>(() => {
    const line = mapModel(course).line;
    return line.length >= 2 ? { line: makePolyline(line.map((p) => p[0]), line.map((p) => p[1])), loop: course?.kind === 'loop' } : null;
  }, [course]);
  if (!follow.friendId) return { gap: null, front: null };
  const nickname = follow.nickname ?? '앞 친구';
  const origin = snap?.origin;
  if (!origin) return { gap: { nickname, targetS, gapS: null, stale: true }, front: null };
  // 좌표계(원점)가 바뀌면 다시 넣고, 아니면 새로 온 것만 넣는다. 친구 GPS 속도도 같이 (지금 간격 예측에 쓴다)
  const key = `${follow.friendId}:${origin.lat}:${origin.lon}`;
  const pts = follow.points;
  const toPt = (p: (typeof pts)[number]) => ({ t: p.t, ...toLocal(origin, p.lat, p.lon), v: p.speed });
  if (fed.current.key !== key || (pts.length > 0 && pts[pts.length - 1]!.t < fed.current.lastT)) {
    tracker.current.reset(pts.map(toPt));
    marker.current.reset(pts.map(toPt));
    fed.current = { key, n: pts.length, lastT: pts.at(-1)?.t ?? 0 };
  } else {
    for (const p of pts)
      if (p.t > fed.current.lastT) {
        tracker.current.push(toPt(p));
        marker.current.push(toPt(p));
      }
    fed.current.lastT = pts.at(-1)?.t ?? fed.current.lastT;
  }
  const pos = snap?.pos;
  const me = pos && snap.utcOffsetMs !== null ? { x: pos.x, y: pos.y, psi: pos.psi, t: snap.t + snap.utcOffsetMs } : null;
  // 신호 끊김은 내 위치 시각(GPS 기준)으로 판단한다 (폰 시계와 무관, 재생 모드의 가상 시각에서도 맞다)
  const r = me ? tracker.current.update(me, me.t) : { gapS: null, stale: tracker.current.latest() === null || Date.now() - tracker.current.latest()!.t > 5000 };
  // 아이콘은 내 위치와 같은 시각(GPS 기준)으로 예측해야 지도에서 둘의 거리가 맞다
  const f = me && !r.stale ? marker.current.position(me.t, road) : null;
  return { gap: { nickname, targetS, gapS: r.gapS, stale: r.stale }, front: f ? { x: f.x, y: f.y, label: nickname } : null };
}

/** 주행 중 위치를 공유 중인 친구들 (사용자 요청): 5초마다 받아 와 주행 지도 평면으로. 앞 친구(간격)는 따로 그리므로 뺀다 */
export function useDriveFriends(snap: LiveSnapshot | null, frontId: string | null): Array<{ x: number; y: number; label: string }> {
  const acc = useAccount();
  const fr = useFriends();
  const { driveFriends } = useSettings();
  const on = acc.status === 'ready' && snap !== null && driveFriends;
  useEffect(() => (on ? watchFriendPositions() : undefined), [on]);
  const origin = snap?.origin;
  if (!on || !origin) return [];
  return fr.positions.filter((p) => p.userId !== frontId).map((p) => ({ ...toLocal(origin, p.lat, p.lon), label: p.nickname }));
}

export function DriveScreen() {
  const d = useDrive();
  const snap = useLiveSnapshot();
  const settings = useSettings();
  const follow = useFollow();
  // 재생 중에는 앞 친구 간격을 쓰지 않는다. 다만 재생 모드의 가상 친구 따라가기는 예외 (목표 2.0초)
  const virtual = follow.friendId === VIRTUAL_FRIEND.id;
  const useGap = !d.replay || virtual;
  const { gap, front } = useFrontGap(useGap ? snap : null, useGap ? follow : { ...follow, friendId: null }, virtual ? VIRTUAL_FRIEND.targetS : settings.gap.targetS, d.course);
  const friends = useDriveFriends(d.replay ? null : snap, follow.friendId);
  if (d.phase === 'idle' && !d.replay) {
    return (
      <main className="page page-full">
        <div className="empty">진행 중인 주행이 없습니다.</div>
        <a className="primary-btn" href="#/">
          메인으로
        </a>
      </main>
    );
  }
  return (
    <DriveView
      snap={snap}
      gap={gap}
      front={front}
      friends={friends}
      course={d.course}
      refLap={d.ref}
      mode={d.mode}
      settings={settings}
      replay={d.replay}
      error={d.error}
      onCycle={cycleDriveMode}
      onEnd={() => void endDrive()}
    />
  );
}
