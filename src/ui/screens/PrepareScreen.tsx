// 주행 준비 (사양서 8.3, 디자인 시안 Prepare)
import { MountTips } from '../components/MountTips';
import { GapSection } from '../components/GapSection';
import { useState } from 'react';
import { cancelPrepare, chooseCourse, chooseRef, setDriveMode, startDrive, useDrive, useLiveSnapshot } from '../../app/drive';
import { useRecording } from '../../app/recording';
import { MAP_VIEW_LABEL, updateSettings, useSettings, WIDGET_LABEL, type DriveMode } from '../../app/settings';
import { Sheet } from '../components/Sheet';
import { formatDayKst, formatLapTime, formatLength } from '../format';
import { IconBack, IconCheck, IconChevron, IconGps, IconPhone, IconPin, IconWarn } from '../icons';

const MODES: Array<[DriveMode, string]> = [
  ['map', '지도'],
  ['minimal', '미니멀'],
  ['dashboard', '대시보드'],
];

export function PrepareScreen() {
  const d = useDrive();
  const rec = useRecording();
  const snap = useLiveSnapshot();
  const settings = useSettings();
  const [sheet, setSheet] = useState<'course' | 'ref' | null>(null);
  const [tips, setTips] = useState(false);

  if (d.phase !== 'preparing') {
    return (
      <main className="page page-full">
        <div className="empty">주행 준비 중이 아닙니다.</div>
        <a className="primary-btn" href="#/">
          메인으로
        </a>
      </main>
    );
  }

  const gps = snap?.gps;
  const cal = snap?.calibration;
  const gpsReady = gps?.ready ?? false;
  const motionOk = rec.motionPermission === 'granted' || rec.motionPermission === 'not-needed';
  const motionLabel =
    rec.motionPermission === null
      ? '확인 중'
      : motionOk
        ? cal && !cal.motionActive && rec.phase === 'recording'
          ? '값이 오지 않음 · G값 없이 기록'
          : '허용됨'
        : rec.motionPermission === 'denied'
          ? '거부됨 · G값 없이 기록'
          : '지원 안 함 · G값 없이 기록';
  const stillLeft = cal ? Math.max(0, Math.ceil(3 * (1 - cal.stillProgress))) : 3;
  const mount =
    !motionOk || (cal && !cal.motionActive)
      ? { right: '건너뜀', text: '모션 센서 없이 GPS만으로 기록합니다.', progress: null }
      : !cal || cal.state === 'need_stationary'
        ? { right: `${stillLeft}초 남음`, text: '3초간 정차해 주세요. 어느 쪽이 아래인지 재고 있습니다.', progress: cal?.stillProgress ?? 0 }
        : cal.state === 'need_forward'
          ? { right: '정차 확인됨', text: '출발 뒤 곧은 길에서 가속·제동하면 앞 방향을 마저 잽니다.', progress: 1 }
          : { right: '완료', text: cal.signsConfirmed ? '거치 방향을 모두 확인했습니다.' : '코너를 몇 번 돌면 좌우 방향을 확인합니다.', progress: 1 };

  return (
    <main className="page page-full">
      <header className="page-head">
        <button type="button" className="back-btn" aria-label="메인으로 (기록 취소)" onClick={() => void cancelPrepare()}>
          <IconBack size={24} />
        </button>
        <h1>주행 준비</h1>
      </header>

      {rec.error && <div className="notice warn">{rec.error}</div>}
      {rec.gpsError === 'denied' && (
        <div className="notice warn">
          <IconWarn size={20} />
          위치 권한이 거부되었습니다. 브라우저 설정에서 이 사이트의 위치를 허용한 뒤 다시 시작해 주세요.
        </div>
      )}

      <section aria-label="코스" className="card card-row">
        <div className="card-col">
          <span className="label-row">
            <IconPin size={14} />
            {d.course ? (d.courseChosen ? '직접 고름' : '현재 위치에서 감지됨') : '근처에 저장된 코스 없음'}
          </span>
          <span className="title">{d.course ? d.course.name : '새 코스'}</span>
          <span className="sub">
            {d.course ? `${d.course.kind === 'loop' ? '랩' : '편도'} · ${formatLength(d.course.lengthM)}` : '달리면 자동으로 코스를 만들어요'}
          </span>
        </div>
        <button type="button" className="change-btn" onClick={() => setSheet('course')}>
          변경
        </button>
      </section>

      <section aria-label="비교 랩" className="card card-row">
        <div className="card-col">
          <span className="label">비교 랩</span>
          {d.ref ? (
            <>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{d.ref.id === d.refs[0]?.id ? '내 베스트' : '고른 랩'}</span>
                <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>
                  {formatLapTime(d.ref.lapTimeMs, 3)}
                </span>
              </span>
              <span className="sub">
                {formatDayKst(d.ref.startedAt)} · 랩 {d.ref.lapNo}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 15, color: 'var(--fg-2)' }}>{d.course ? '아직 유효 랩이 없어요' : '첫 주행은 비교 없이 코스를 기록해요'}</span>
          )}
        </div>
        {d.refs.length > 1 && (
          <button type="button" className="change-btn" onClick={() => setSheet('ref')}>
            변경
          </button>
        )}
      </section>

      <section aria-label="화면 모드" className="card-col" style={{ gap: 8 }}>
        <span className="label">화면 모드 · 주행 중 두 번 탭하면 다음 모드</span>
        <div className="segmented" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {MODES.map(([m, label]) => (
            <button key={m} type="button" aria-pressed={d.mode === m} onClick={() => setDriveMode(m)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {d.mode === 'map' && (
        <section aria-label="지도 보기" className="card-col" style={{ gap: 8 }}>
          <span className="label">지도 보기</span>
          <div className="segmented small" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {(['fit', 'follow', 'heading'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={settings.mapView === k} onClick={() => updateSettings({ mapView: k })}>
                {MAP_VIEW_LABEL[k]}
              </button>
            ))}
          </div>
        </section>
      )}

      <GapSection />

      <a className="list-link" href="#/prepare/widgets">
        <span className="card-col" style={{ gap: 3 }}>
          <span className="label">상단 표시 값</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            델타 + {WIDGET_LABEL[settings.widgets[0]]} · {WIDGET_LABEL[settings.widgets[1]]}
          </span>
        </span>
        <IconChevron size={20} color="#9AA1A9" />
      </a>

      <section aria-label="준비 상태" className="card status-list">
        <div className="status-item">
          <div className="status-head">
            {gpsReady ? <IconCheck color="#3EE08F" /> : <IconGps color={gps?.hAcc != null ? '#FFB224' : '#5E656D'} />}
            <strong>GPS</strong>
            <span>
              {gpsReady ? '준비 완료' : 'GPS 대기 중'}
              {gps?.hAcc != null && (
                <>
                  {' · 오차 '}
                  <span className="mono">{Math.round(gps.hAcc)}m</span>
                </>
              )}
            </span>
          </div>
        </div>
        <div className="status-item">
          <div className="status-head">
            {motionOk ? <IconCheck color="#3EE08F" /> : <IconWarn color="#FFB224" />}
            <strong>모션 센서</strong>
            <span>{motionLabel}</span>
          </div>
        </div>
        <div className="status-item">
          <div className="status-head">
            <IconPhone color="#aacae6" />
            <strong>거치 보정</strong>
            <span style={{ color: mount.right === '완료' ? '#3EE08F' : 'var(--accent)' }}>{mount.right}</span>
          </div>
          <span style={{ fontSize: 13 }} className="dim">
            {mount.text}
          </span>
          {mount.progress !== null && mount.progress < 1 && (
            <div className="progress" role="progressbar" aria-label="거치 보정 진행" aria-valuenow={Math.round(mount.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.round(mount.progress * 100)}%` }} />
            </div>
          )}
          <button type="button" className="link-btn" aria-expanded={tips} onClick={() => setTips(!tips)}>
            {tips ? '거치 팁 닫기' : '거치 팁 보기'}
          </button>
          {tips && <MountTips />}
        </div>
      </section>

      <div style={{ flex: 1 }} />
      <button type="button" className="primary-btn record" disabled={rec.phase !== 'recording'} onClick={startDrive}>
        {rec.phase === 'starting' ? '센서를 켜는 중…' : '기록 시작'}
      </button>
      <div className="card-col" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span style={{ fontSize: 13 }} className="dim">
          {!gpsReady && rec.phase === 'recording' ? 'GPS가 아직 준비되지 않았어요. 잠시 기다리면 더 정확해요' : '출발선을 지나면 랩 측정이 시작됩니다'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>주행 중에는 화면을 조작하지 마세요</span>
      </div>

      {sheet === 'course' && (
        <Sheet title="코스 고르기" onClose={() => setSheet(null)}>
          <button
            type="button"
            className="sheet-item"
            aria-pressed={d.course === null}
            onClick={() => {
              chooseCourse(null);
              setSheet(null);
            }}
          >
            <span className="card-col">
              <strong>새 코스</strong>
              <span className="sub">코스 없이 달리고, 끝난 뒤 코스로 저장</span>
            </span>
          </button>
          {d.courses.map((c) => (
            <button
              key={c.id}
              type="button"
              className="sheet-item"
              aria-pressed={d.course?.id === c.id}
              onClick={() => {
                chooseCourse(c);
                setSheet(null);
              }}
            >
              <span className="card-col">
                <strong>{c.name}</strong>
                <span className="sub">
                  {c.kind === 'loop' ? '랩' : '편도'} · {formatLength(c.lengthM)}
                </span>
              </span>
            </button>
          ))}
        </Sheet>
      )}
      {sheet === 'ref' && (
        <Sheet title="비교 랩 고르기" onClose={() => setSheet(null)}>
          {d.refs.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className="sheet-item"
              aria-pressed={d.ref?.id === r.id}
              onClick={() => {
                chooseRef(r);
                setSheet(null);
              }}
            >
              <span className="card-col">
                <strong className="mono">{formatLapTime(r.lapTimeMs, 3)}</strong>
                <span className="sub">
                  {formatDayKst(r.startedAt)} · 랩 {r.lapNo}
                  {i === 0 ? ' · 내 베스트' : ''}
                </span>
              </span>
            </button>
          ))}
        </Sheet>
      )}
    </main>
  );
}
