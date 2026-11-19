// 설정 › 저장 공간 (기록은 폰에만 7단계, 시안 docs/mock/2026-11-18-local-storage.jpg ①):
// 기록은 이 폰에만 있으니 얼마나 쓰는지와 한도를 보인다. 원본은 최근 30개만(주행을 처리할 때마다 저절로 정리),
// 막대는 브라우저가 알려 주는 디고 저장 공간. 웹은 사파리가 오래 안 쓴 사이트 저장소를 지울 수 있어 안내하고 보존을 부탁한다.
import { useEffect, useState } from 'react';
import { MY_COURSE_LIMIT, RAW_KEEP } from '../../app/limits';
import { getDriveRepo, getRepo, refreshSessions, useRecording } from '../../app/recording';
import { pruneOldRaw, storageSummary, type StorageSummary } from '../../app/storageLimits';
import { isApp } from '../../platform';
import { formatBytes } from '../format';

let askedPersist = false;

export function StorageSection() {
  const { sessions } = useRecording();
  const [s, setS] = useState<StorageSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    // 저장소를 못 열면(사생활 보호 모드 등) 숫자 없이 둔다
    void storageSummary(getRepo(), getDriveRepo())
      .then((v) => alive && setS(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessions, tick]);
  useEffect(() => {
    if (isApp() || askedPersist) return;
    askedPersist = true;
    void navigator.storage?.persist?.().catch(() => false);
  }, []);
  const prune = async () => {
    setBusy(true);
    try {
      if ((await pruneOldRaw(getRepo())) > 0) await refreshSessions();
    } finally {
      setBusy(false);
      setTick((t) => t + 1);
    }
  };
  const ratio = s?.usage ? Math.min(1, s.usage.used / s.usage.quota) : null;
  return (
    <section className="card card-col" style={{ gap: 10 }} aria-label="저장 공간">
      <span className="label">저장 공간 (이 폰)</span>
      <div className="kv-row">
        <span>주행 기록</span>
        <b>{s ? `${s.sessions}개` : '…'}</b>
      </div>
      <div className="kv-row">
        <span>원본 센서 자료</span>
        <b>{!s ? '…' : s.rawSessions === 0 ? '없음' : `최근 ${s.rawSessions}개 · ${formatBytes(s.rawBytes)}`}</b>
      </div>
      <div className="kv-row">
        <span>내 코스</span>
        <b>{s ? `${s.myCourses} / ${MY_COURSE_LIMIT}` : '…'}</b>
      </div>
      {ratio !== null && (
        <div className="usage-bar" role="img" aria-label={`디고가 쓰는 저장 공간 ${formatBytes(s!.usage!.used)}`}>
          <i style={{ width: `${Math.max(2, ratio * 100)}%` }} />
        </div>
      )}
      <span className="sub">원본은 최근 {RAW_KEEP}개 주행만 남겨요(오래된 것부터 저절로 정리). 랩·요약·궤적은 계속 남아요.</span>
      {!isApp() && <span className="notice">브라우저는 오래 안 쓰면 기록을 지울 수 있어요 · 홈 화면에 추가하거나 백업해 두세요</span>}
      <button type="button" className="btn" disabled={busy || !s || s.prunable === 0} onClick={() => void prune()}>
        오래된 원본 지금 지우기
      </button>
    </section>
  );
}
