// 주행 화면 (사양서 8.4, 디자인 시안 DriveMap·DriveMinimal·DriveDashboard)
// 두 번 탭하면 모드 전환(지도 → 미니멀 → 대시보드), 2초 길게 눌러 종료. 그 밖의 터치는 무시한다.
// 지도 모드의 델타·고른 값·미니맵은 오버레이 그리기 함수(src/ui/overlay)로 캔버스에 그린다 (사양서 13.1 확장 지점).
import { useMemo, useRef } from 'react';
import { useFollow, type FollowState } from '../../app/liveLink';
import { toLocal } from '../../engine/geo';
import { GapTracker } from '../../engine/live/gap';
import { cycleDriveMode, endDrive, useDrive, useLiveSnapshot, type DriveState } from '../../app/drive';
import { useSettings, type DriveMode, type Settings, type WidgetId } from '../../app/settings';
import type { LiveSnapshot } from '../../engine/live/livePipeline';
import type { LiveState } from '../../engine/live/liveEngine';
import type { Course } from '../../types/course';
import type { RefLapRecord } from '../../types/drive';
import { GMeter } from '../components/GMeter';
import { LongPressButton } from '../components/LongPressButton';
import { OverlayCanvas } from '../components/OverlayCanvas';
import { ReplayMap } from '../components/ReplayMap';
import { formatDelta, formatLapTime } from '../format';
import { IconGps } from '../icons';
import { drawDeltaPanel, drawGTile, drawValueTile, gMeterLabel } from '../overlay/draw';
import { frameFromLive, gLabel, headline, widgetValue, type GapInfo, type OverlayFrame } from '../overlay/frame';
import { drawMiniMap, followView, mapModel } from '../overlay/minimap';
import { useSmoothAngle, useSpanM } from '../hooks/useSmoothView';
import { overlayTheme, type OverlayTheme } from '../overlay/theme';

export interface DriveViewProps {
  snap: LiveSnapshot | null;
  /** 앞 친구 간격 (M9). 없으면 끔 */
  gap?: GapInfo | null;
  /** 앞 친구 위치 (같은 평면 좌표) */
  front?: { x: number; y: number; label: string } | null;
  course: Course | null;
  refLap: RefLapRecord | null;
  mode: DriveMode;
  settings: Settings;
  replay: DriveState['replay'];
  error: string | null;
  onCycle: () => void;
  onEnd: () => void;
}

const NEXT_LABEL: Record<DriveMode, string> = { map: '미니멀', minimal: '대시보드', dashboard: '지도' };
const DOUBLE_TAP_MS = 350;
const LAP_FLASH_MS = 3000;

const deltaClass = (d: number | null) => (d === null ? '' : d < 0 ? 'fast' : d > 0 ? 'slow' : '');
const kmh = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v)));

/** 섹터 시간: 1분 미만이면 41.803, 넘으면 1:02.345 */
function sectorTime(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 60_000 ? (Math.floor(ms) / 1000).toFixed(3) : formatLapTime(ms, 3);
}

/** G 보정이 어디서 멈췄는지 (정차 3초 → 직진 가감속 → 가감속·코너 확인) */
export function gCalText(snap: LiveSnapshot | null): string {
  const p = snap?.calibration.progress;
  if (!p) return 'G 보정 안 됨';
  if (p.stage === 'stationary') return `G 보정: 정차 ${Math.floor((snap?.calibration.stillProgress ?? 0) * 3)}/3초`;
  if (p.stage === 'forward') return `G 보정: 직진 가감속 ${p.fwd}/${p.fwdNeed}`;
  if (p.stage === 'signs') return `G 보정: 가감속 ${Math.min(p.fwd, p.fwdNeed)}/${p.fwdNeed} · 코너 ${Math.min(p.turns, p.turnsNeed)}/${p.turnsNeed}`;
  return 'G 보정 안 됨';
}

function StatusBar({ snap, mode, course, replay, gap }: { snap: LiveSnapshot | null; mode: DriveMode; course: Course | null; replay: DriveState['replay']; gap?: GapInfo | null }) {
  const st = snap?.state;
  const hAcc = snap?.gps.hAcc;
  const weak = !snap || st?.status.gpsWeak || (snap.gps.ageMs ?? Infinity) > 3000;
  const flags: Array<{ text: string; cls: string }> = [];
  if (replay) flags.push({ text: `재생 ${replay.speed}×${replay.ended ? ' · 끝' : ''}`, cls: 'warn' });
  if (gap?.stale) flags.push({ text: '앞 친구 신호 없음', cls: 'warn' });
  if (!course) flags.push({ text: '코스 기록 중', cls: '' });
  if (st?.status.offCourse && course) flags.push({ text: '코스 이탈', cls: 'bad' });
  if (snap && !snap.calibration.motionActive) flags.push({ text: 'G 없음', cls: '' });
  else if (st?.status.gNotCalibrated) flags.push({ text: gCalText(snap), cls: '' });
  return (
    <div className="drive-status">
      <span className="flags">
        <IconGps size={18} color={weak ? '#FF5B4F' : '#3EE08F'} />
        <span>
          {weak ? 'GPS 약함' : 'GPS'} <span className="mono gps-m">{hAcc === null || hAcc === undefined ? '—' : `${Math.round(Math.min(hAcc, 999))}m`}</span>
        </span>
        {flags.map((f) => (
          <span key={f.text} className={`flag ${f.cls}`}>
            {f.text}
          </span>
        ))}
      </span>
      <span className="hint">두 번 탭하면 {NEXT_LABEL[mode]}</span>
    </div>
  );
}

/** 지도 모드 상단의 고른 값 한 칸 (캔버스) */
function WidgetCanvas({ id, frame, th }: { id: WidgetId; frame: OverlayFrame; th: OverlayTheme }) {
  if (id === 'g') {
    return <OverlayCanvas className="tile g" label={gMeterLabel(frame)} draw={(ctx, w, h) => drawGTile(ctx, w, h, frame, th)} />;
  }
  const v = widgetValue(id, frame);
  return <OverlayCanvas className="tile" label={`${v.label} ${v.value}${v.unit ? ` ${v.unit}` : ''}`} draw={(ctx, w, h) => drawValueTile(ctx, w, h, v, th)} />;
}

export function DriveView({ snap, gap = null, front = null, course, refLap, mode, settings, replay, error, onCycle, onEnd }: DriveViewProps) {
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const st = snap?.state ?? null;
  const frame: OverlayFrame = { ...frameFromLive(snap, course !== null, refLap !== null), gap };
  const hl = headline(frame);
  const h = { label: hl.label, text: hl.text, word: hl.word, cls: hl.tone === 'none' ? '' : hl.tone };
  const th = useMemo(() => overlayTheme(settings.deltaPalette), [settings.deltaPalette]);
  // 나를 가운데 / 진행 방향 위 보기: 진행 방향과 보이는 거리를 부드럽게 (훅은 모드와 관계없이 늘 부른다)
  const headSm = useSmoothAngle(snap?.pos?.psi);
  const spanM = useSpanM(st?.speedKmh);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.end-btn, .map-view-toggle')) return;
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
          <StatusBar snap={snap} mode={mode} course={course} replay={replay} gap={gap} />
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
            <div className="dash-tile" style={{ alignItems: 'center', padding: '14px 16px' }}>
              <span style={{ alignSelf: 'flex-start', fontSize: 13 }} className="dim">
                G
              </span>
              <GMeter gx={st?.gx ?? null} gy={st?.gy ?? null} size={124} />
              <GText st={st} />
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
            <StatusBar snap={snap} mode={mode} course={course} replay={replay} gap={gap} />
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
  const viewFor = (w: number, hh: number) =>
    mapView === 'fit' || !me ? undefined : followView(me, w, hh, { spanM, insetBottom: 120, top: 0, headingUp: mapView === 'heading' ? (headSm ?? me.psi ?? null) : null });
  return (
    <div className="drive mode-map" onPointerDown={onPointerDown} data-testid="drive">
      <div className="drive-pad">
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
      <div className="drive-map">
        {replay || settings.mapTiles ? (
          // 바탕 지도(OSM) 위에 그린다 (사용자 요청). 통신이 없거나 타일이 안 오면 타일 없이 그린다
          <ReplayMap model={model} frame={frame} origin={snap?.origin ?? null} th={th} insetBottom={120} label={mapLabel} friend={front} initialView={mapView} heading={headSm} viewToggle={replay !== null} />
        ) : (
          <OverlayCanvas style={{ position: 'absolute', inset: 0 }} label={mapLabel} draw={(ctx, w, hh) => drawMiniMap(ctx, w, hh, model, frame, th, { insetBottom: 120, margin: 28, friend: front, view: viewFor(w, hh) })} />
        )}
        <div className="drive-bottom">
          <StatusBar snap={snap} mode={mode} course={course} replay={replay} gap={gap} />
          {end(false)}
        </div>
      </div>
    </div>
  );
}

function GText({ st }: { st: LiveState | null }) {
  const l = gLabel(st?.gx ?? null, st?.gy ?? null);
  return (
    <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>
      {l.lat} <span className="mono">{l.latV}</span> · {l.long} <span className="mono">{l.longV}</span>
    </span>
  );
}

/** 받은 앞 친구 위치로 간격을 계산한다 (그릴 때마다, 1초 동안 부드럽게) */
export function useFrontGap(snap: LiveSnapshot | null, follow: FollowState, targetS: number): { gap: GapInfo | null; front: DriveViewProps['front'] } {
  const tracker = useRef(new GapTracker());
  const fed = useRef<{ key: string; n: number; lastT: number }>({ key: '', n: 0, lastT: 0 });
  if (!follow.friendId) return { gap: null, front: null };
  const nickname = follow.nickname ?? '앞 친구';
  const origin = snap?.origin;
  if (!origin) return { gap: { nickname, targetS, gapS: null, stale: true }, front: null };
  // 좌표계(원점)가 바뀌면 다시 넣고, 아니면 새로 온 것만 넣는다
  const key = `${follow.friendId}:${origin.lat}:${origin.lon}`;
  const pts = follow.points;
  if (fed.current.key !== key || (pts.length > 0 && pts[pts.length - 1]!.t < fed.current.lastT)) {
    tracker.current.reset(pts.map((p) => ({ t: p.t, ...toLocal(origin, p.lat, p.lon) })));
    fed.current = { key, n: pts.length, lastT: pts.at(-1)?.t ?? 0 };
  } else {
    for (const p of pts) if (p.t > fed.current.lastT) tracker.current.push({ t: p.t, ...toLocal(origin, p.lat, p.lon) });
    fed.current.lastT = pts.at(-1)?.t ?? fed.current.lastT;
  }
  const pos = snap?.pos;
  const me = pos && snap.utcOffsetMs !== null ? { x: pos.x, y: pos.y, psi: pos.psi, t: snap.t + snap.utcOffsetMs } : null;
  const r = me ? tracker.current.update(me, Date.now()) : { gapS: null, stale: tracker.current.latest() === null || Date.now() - tracker.current.latest()!.t > 5000 };
  const last = tracker.current.latest();
  return { gap: { nickname, targetS, gapS: r.gapS, stale: r.stale }, front: last && !r.stale ? { x: last.x, y: last.y, label: nickname } : null };
}

export function DriveScreen() {
  const d = useDrive();
  const snap = useLiveSnapshot();
  const settings = useSettings();
  const follow = useFollow();
  const { gap, front } = useFrontGap(d.replay ? null : snap, d.replay ? { ...follow, friendId: null } : follow, settings.gap.targetS);
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
