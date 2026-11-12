// 주행 화면 (사양서 8.4, 디자인 시안 DriveMap·DriveMinimal·DriveDashboard)
// 두 번 탭하면 모드 전환(지도 → 미니멀 → 대시보드), 2초 길게 눌러 종료. 그 밖의 터치는 무시한다.
import { useRef } from 'react';
import { cycleDriveMode, endDrive, useDrive, useLiveSnapshot, type DriveState } from '../../app/drive';
import { useSettings, WIDGET_LABEL, type DriveMode, type Settings, type WidgetId } from '../../app/settings';
import type { LiveSnapshot } from '../../engine/live/livePipeline';
import type { LiveState } from '../../engine/live/liveEngine';
import type { Course } from '../../types/course';
import type { RefLapRecord } from '../../types/drive';
import { CourseMap } from '../components/CourseMap';
import { GMeter, gLabel } from '../components/GMeter';
import { LongPressButton } from '../components/LongPressButton';
import { formatDelta, formatLapTime } from '../format';
import { IconGps } from '../icons';

export interface DriveViewProps {
  snap: LiveSnapshot | null;
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
const deltaWord = (d: number | null) => (d === null ? '' : d < 0 ? '빠름' : d > 0 ? '느림' : '같음');
const kmh = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v)));

/** 섹터 시간: 1분 미만이면 41.803, 넘으면 1:02.345 */
function sectorTime(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 60_000 ? (Math.floor(ms) / 1000).toFixed(3) : formatLapTime(ms, 3);
}

/** 델타 패널에 보여줄 것: 첫 주행이면 출발 뒤 경과, 아니면 델타 */
function headline(st: LiveState | null, course: Course | null, ref: RefLapRecord | null) {
  if (!course) return { label: '코스 기록 중 · 출발 뒤', text: formatLapTime(st?.lapElapsedMs ?? null, 1), cls: '', word: '' };
  if (!ref) return { label: '비교 랩 없음', text: '—', cls: '', word: '' };
  if (!st || st.lapNo === 0) return { label: '출발선을 지나면 시작', text: '—', cls: '', word: '' };
  const d = st.delta;
  return { label: '베스트 대비', text: formatDelta(d), cls: deltaClass(d), word: deltaWord(d) };
}

function StatusBar({ snap, mode, course, replay }: { snap: LiveSnapshot | null; mode: DriveMode; course: Course | null; replay: DriveState['replay'] }) {
  const st = snap?.state;
  const hAcc = snap?.gps.hAcc;
  const weak = !snap || st?.status.gpsWeak || (snap.gps.ageMs ?? Infinity) > 3000;
  const flags: Array<{ text: string; cls: string }> = [];
  if (replay) flags.push({ text: `재생 ${replay.speed}×${replay.ended ? ' · 끝' : ''}`, cls: 'warn' });
  if (!course) flags.push({ text: '코스 기록 중', cls: '' });
  if (st?.status.offCourse && course) flags.push({ text: '코스 이탈', cls: 'bad' });
  if (snap && !snap.calibration.motionActive) flags.push({ text: 'G 없음', cls: '' });
  else if (st?.status.gNotCalibrated) flags.push({ text: 'G 보정 안 됨', cls: '' });
  return (
    <div className="drive-status">
      <span className="flags">
        <IconGps size={18} color={weak ? '#FF5B4F' : '#3EE08F'} />
        <span>
          {weak ? 'GPS 약함' : 'GPS'} <span className="mono">{hAcc === null || hAcc === undefined ? '—' : `${Math.round(hAcc)}m`}</span>
        </span>
        {flags.map((f) => (
          <span key={f.text} className={`flag ${f.cls}`}>
            {f.text}
          </span>
        ))}
      </span>
      <span>두 번 탭하면 {NEXT_LABEL[mode]}</span>
    </div>
  );
}

function Widget({ id, st, snap }: { id: WidgetId; st: LiveState | null; snap: LiveSnapshot | null }) {
  if (id === 'g') {
    const l = gLabel(st?.gx ?? null, st?.gy ?? null);
    return (
      <div className="tile g">
        <GMeter gx={st?.gx ?? null} gy={st?.gy ?? null} size={64} />
        <div className="card-col" style={{ gap: 2 }}>
          <span className="label">G</span>
          <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            {l.lat} <span className="mono" style={{ color: 'var(--fg)' }}>{l.latV}</span>
          </span>
          <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            {l.long} <span className="mono" style={{ color: 'var(--fg)' }}>{l.longV}</span>
          </span>
        </div>
      </div>
    );
  }
  let value: string;
  let unit = '';
  let cls = '';
  if (id === 'speed') {
    value = kmh(st?.speedKmh ?? (snap ? 0 : null));
    unit = 'km/h';
  } else if (id === 'vmax') {
    value = kmh(st?.maxSpeedKmh);
    unit = 'km/h';
  } else if (id === 'lap') {
    value = formatLapTime(st?.lapElapsedMs ?? null, 1);
  } else if (id === 'lapno') {
    value = st && st.lapNo > 0 ? String(st.lapNo) : '—';
    unit = st && st.lapNo > 0 ? '랩' : '';
  } else {
    const i = st?.currentSector ?? null;
    const d = i === null ? null : (st?.sectorDeltas[i] ?? null);
    value = i === null ? '—' : `S${i + 1} ${formatDelta(d)}`;
    cls = deltaClass(d);
  }
  return (
    <div className="tile">
      <span className="label">{WIDGET_LABEL[id]}</span>
      <span className={`tile-big ${cls}`} style={id === 'sector' ? { fontSize: 30 } : undefined}>
        <span className={id === 'sector' ? `sector-delta ${cls}` : ''} style={id === 'sector' ? { fontSize: 'inherit' } : undefined}>
          {value}
        </span>
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

export function DriveView({ snap, course, refLap, mode, settings, replay, error, onCycle, onEnd }: DriveViewProps) {
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const st = snap?.state ?? null;
  const h = headline(st, course, refLap);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.end-btn')) return;
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
          <StatusBar snap={snap} mode={mode} course={course} replay={replay} />
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
            <StatusBar snap={snap} mode={mode} course={course} replay={replay} />
            {end(true)}
          </div>
        </div>
      </div>
    );
  }

  // 지도 모드
  return (
    <div className="drive mode-map" onPointerDown={onPointerDown} data-testid="drive">
      <div className="drive-pad">
        <div className={`delta-panel delta-map ${h.cls}`}>
          <div className="card-col">
            <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>
              {h.label}
              {h.word && (
                <>
                  {' · '}
                  <b className={`delta-word ${h.cls}`}>{h.word}</b>
                </>
              )}
            </span>
            <span className="delta-text" style={!course ? { color: 'var(--fg)' } : undefined}>
              {h.text}
            </span>
          </div>
          {course && (
            <div className="card-col" style={{ alignItems: 'flex-end' }}>
              <span className="label">{lapNo ? `랩 ${lapNo}` : '랩'}</span>
              <span className="mono" style={{ fontSize: 24, fontWeight: 500 }}>
                {formatLapTime(st?.lapElapsedMs ?? null, 1)}
              </span>
            </div>
          )}
        </div>
        <div className="widget-row">
          <Widget id={settings.widgets[0]} st={st} snap={snap} />
          <Widget id={settings.widgets[1]} st={st} snap={snap} />
        </div>
      </div>
      <div className="drive-map">
        <CourseMap
          variant="drive"
          course={course}
          me={snap?.pos ?? null}
          ghost={course && refLap ? (snap?.ghost ?? null) : null}
          path={course ? undefined : snap?.path}
          insetBottom={120}
          label="코스 지도: 내 위치와 베스트 고스트"
        />
        <div className="drive-bottom">
          <StatusBar snap={snap} mode={mode} course={course} replay={replay} />
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

export function DriveScreen() {
  const d = useDrive();
  const snap = useLiveSnapshot();
  const settings = useSettings();
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
