// 개발자용 센서 기록 테스트 화면 (M2). 실제 폰에서 센서가 무엇을 주는지 확인하고 원본을 모은다.
// 정식 주행 화면은 M5에서 만든다.
import { useState } from 'react';
import {
  startRecording,
  stopRecording,
  useRecording,
  getRepo,
  type RecordingState,
} from '../../app/recording';
import { prepareRawFile, shareOrDownload, type RawFileExt } from '../../storage/exportFile';
import type { SessionRecord, SessionStatus } from '../../types/session';
import { formatDuration, formatKst } from '../format';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

const LOCATION_LABEL: Record<RecordingState['locationPermission'], string> = {
  granted: '허용됨',
  denied: '거부됨',
  prompt: '아직 안 물어봄 (기록 시작 때 물어봄)',
  unknown: '확인 못 함',
};

const MOTION_LABEL: Record<NonNullable<RecordingState['motionPermission']>, string> = {
  granted: '허용됨',
  denied: '거부됨',
  'not-needed': '허용 필요 없음',
  unsupported: '지원 안 함',
};

const WAKE_LABEL: Record<RecordingState['wakeLock'], string> = {
  off: '꺼짐',
  active: '켜짐',
  unsupported: '지원 안 함',
  failed: '실패',
};

const GPS_ERROR_LABEL: Record<NonNullable<RecordingState['gpsError']>, string> = {
  denied: '위치 권한이 거부되었습니다',
  unavailable: '위치를 받을 수 없습니다 (실내이거나 위치 서비스가 꺼져 있을 수 있음)',
  timeout: '위치 응답이 늦습니다',
  unsupported: '이 브라우저는 위치를 지원하지 않습니다',
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  recording: '기록 중',
  interrupted: '중단됨',
  finished: '완료',
  processed: '처리됨',
  uploaded: '업로드됨',
};

function locationHelp(): string {
  return isIos()
    ? '아이폰 설정 → 개인정보 보호 및 보안 → 위치 서비스를 켜고, 아래쪽 "Safari 웹 사이트"를 "앱을 사용하는 동안"으로 바꿔 주세요. 그다음 이 앱을 완전히 닫았다가 다시 열어 주세요.'
    : '크롬 메뉴 → 설정 → 사이트 설정 → 위치에서 이 사이트를 "허용"으로 바꿔 주세요. 폰의 위치(GPS)도 켜져 있어야 합니다.';
}

function motionHelp(): string {
  return '모션 권한이 없어 GPS만 기록합니다(G값 없음). 앱을 완전히 닫았다가 다시 열고 "기록 시작"을 누르면 다시 물어봅니다.';
}

function wakeHelp(): string {
  return isIos()
    ? '화면 꺼짐 방지가 동작하지 않습니다. 기록하는 동안 설정 → 디스플레이 및 밝기 → 자동 잠금을 "안 함"으로 바꿔 주세요.'
    : '화면 꺼짐 방지가 동작하지 않습니다. 기록하는 동안 설정 → 디스플레이 → 화면 자동 꺼짐 시간을 길게 바꿔 주세요.';
}

const yesNo = (v: boolean | null, yes: string, no: string) =>
  v === null ? '—' : v ? yes : no;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-value">{value}</span>
    </div>
  );
}

function StatusCard({ s }: { s: RecordingState }) {
  return (
    <section className="card">
      <h2>권한과 상태</h2>
      <Row label="위치 권한" value={LOCATION_LABEL[s.locationPermission]} />
      {s.locationPermission === 'denied' && <p className="help">{locationHelp()}</p>}
      <Row label="모션 권한" value={s.motionPermission ? MOTION_LABEL[s.motionPermission] : '— (기록 시작 때 확인)'} />
      {s.motionPermission === 'denied' && <p className="help">{motionHelp()}</p>}
      <Row label="화면 꺼짐 방지" value={WAKE_LABEL[s.wakeLock]} />
      {(s.wakeLock === 'failed' || s.wakeLock === 'unsupported') && <p className="help">{wakeHelp()}</p>}
      <Row label="저장소 영구 보관" value={yesNo(s.persisted, '허용됨', '허용 안 됨')} />
      <Row
        label="기기"
        value={
          s.device
            ? `${s.device.os} · ${s.device.browser}${s.device.model ? ` · ${s.device.model}` : ''} · ${
                s.device.standalone ? '홈 화면 앱' : '브라우저 탭'
              }`
            : '—'
        }
      />
    </section>
  );
}

function LiveCard({ s }: { s: RecordingState }) {
  const st = s.stats;
  return (
    <section className="card">
      <h2>기록 중 {formatDuration(s.elapsedMs)}</h2>
      {s.gpsError && <p className="help warn">{GPS_ERROR_LABEL[s.gpsError]}</p>}
      <Row label="GPS 수신" value={`${st.gpsCount}회`} />
      <Row label="GPS 정확도" value={st.lastHAcc === null ? '—' : `${st.lastHAcc.toFixed(1)} m`} />
      <Row
        label="마지막 수신"
        value={st.secondsSinceGps === null ? '—' : `${st.secondsSinceGps.toFixed(1)}초 전`}
      />
      <Row
        label="GPS 속도"
        value={
          st.lastSpeedKmh !== null
            ? `${st.lastSpeedKmh.toFixed(1)} km/h`
            : yesNo(st.speedAvailable, '지금은 값 없음', '값 없음')
        }
      />
      <Row label="GPS 방향" value={yesNo(st.headingAvailable, '값 있음', '값 없음')} />
      <Row label="모션" value={`${st.motionHz.toFixed(0)} Hz · ${st.motionCount}개`} />
      <Row label="회전 속도" value={yesNo(st.rotationAvailable, '값 있음', '값 없음 (자이로 없음)')} />
      <Row label="저장" value={`${s.chunksSaved}개 덩어리`} />
      {s.saveError && <p className="help warn">저장 오류: {s.saveError}</p>}
    </section>
  );
}

type Prepared = { sessionId: string; file: File } | null;

function SessionList({ sessions, activeId }: { sessions: SessionRecord[]; activeId: string | null }) {
  const [prepared, setPrepared] = useState<Prepared>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function prepare(sessionId: string, ext: RawFileExt) {
    setBusy(sessionId);
    setNote(null);
    try {
      setPrepared({ sessionId, file: await prepareRawFile(getRepo(), sessionId, ext) });
    } catch (e) {
      setNote(`파일을 만들 수 없습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function share(file: File) {
    const r = await shareOrDownload(file);
    setNote(r === 'cancelled' ? '공유를 취소했습니다' : r === 'shared' ? '공유했습니다' : '다운로드했습니다');
  }

  if (sessions.length === 0) return <p className="muted">아직 기록이 없습니다.</p>;
  return (
    <ul className="session-list">
      {sessions.map((s) => {
        const duration = s.endedAt ? formatDuration(s.endedAt - s.startedAt) : null;
        const ready = prepared?.sessionId === s.id ? prepared.file : null;
        return (
          <li key={s.id} className="session-item">
            <div className="session-title">
              {formatKst(s.startedAt)} · {duration ?? '—'} · {STATUS_LABEL[s.status]}
            </div>
            <div className="session-meta">
              {s.device.os} · {s.device.browser}
            </div>
            {s.id !== activeId && (
              <div className="session-actions">
                <button type="button" className="btn" disabled={busy !== null} onClick={() => void prepare(s.id, 'json.gz')}>
                  파일 만들기 (.gz)
                </button>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => void prepare(s.id, 'json')}>
                  파일 만들기 (.json)
                </button>
              </div>
            )}
            {busy === s.id && <p className="muted">파일을 만드는 중…</p>}
            {ready && (
              <button type="button" className="btn btn-primary" onClick={() => void share(ready)}>
                공유·저장: {ready.name} ({(ready.size / 1024).toFixed(0)} KB)
              </button>
            )}
          </li>
        );
      })}
      {note && <p className="muted">{note}</p>}
    </ul>
  );
}

export function RecorderTestScreen() {
  const s = useRecording();
  const recording = s.phase === 'recording';
  return (
    <main className="screen">
      <header className="screen-header">
        <a href="#/" className="back-link">
          ← 홈
        </a>
        <h1>센서 기록 테스트</h1>
      </header>
      <p className="muted">
        GPS와 모션 원본을 기록해 폰에 5초마다 저장합니다. 기록을 끝낸 뒤 파일을 만들어 보내 주세요.
      </p>
      {s.error && <p className="help warn">{s.error}</p>}

      {recording || s.phase === 'stopping' ? (
        <button
          type="button"
          className="big-btn big-btn-stop"
          disabled={s.phase === 'stopping'}
          onClick={() => void stopRecording()}
        >
          {s.phase === 'stopping' ? '저장 중…' : '기록 종료'}
        </button>
      ) : (
        <button
          type="button"
          className="big-btn"
          disabled={s.phase === 'starting' || !s.ready}
          onClick={startRecording}
        >
          {s.phase === 'starting' ? '시작하는 중…' : '기록 시작'}
        </button>
      )}

      {recording && <LiveCard s={s} />}
      <StatusCard s={s} />

      <section className="card">
        <h2>기록 목록</h2>
        <SessionList sessions={s.sessions} activeId={s.sessionId} />
      </section>
    </main>
  );
}
