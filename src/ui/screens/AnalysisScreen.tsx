// 분석 (사양서 8.6): 랩 목록 → 두 랩 비교(속도·델타·고도 그래프, 가로축 코스 거리), 속도 색칠 지도,
// G 다이어그램, 지점 정보(그래프나 지도를 누르면). 위쪽 "내보내기"(CSV·랩 요약 CSV·GPX).
// 그래프는 trace, 지도·지점 정보·G 다이어그램은 처리된 궤적을 쓴다. 넓은 화면은 그래프와 지도를 나란히.
import { useEffect, useMemo, useState } from 'react';
import { loadAnalysis, loadProcessedOf, type AnalysisData } from '../../app/analysis';
import { loadCalDiagnosis, prepareRawExport } from '../../app/rawTransfer';
import { calDiagnosisLines, type DiagLine } from '../../engine/diagnose/calibration';
import { getRepo } from '../../app/recording';
import { useSettings } from '../../app/settings';
import { loadRaw } from '../../app/sessionProcessing';
import type { GpsSample } from '../../types/samples';
import type { ProcessedTrack } from '../../engine/process/processDrive';
import { csvFileName, lapsCsv, sessionCsv } from '../../export/csv';
import { sessionToGpx } from '../../gpx/export';
import { shareOrDownload } from '../../storage/exportFile';
import { AnalysisMap } from '../analysis/AnalysisMap';
import { CompareChart, type ChartKind } from '../analysis/CompareChart';
import { compareSeries, lapPointAt, nearestLapPoint, speedColor } from '../analysis/compare';
import { GDiagram } from '../analysis/GDiagram';
import { Sheet } from '../components/Sheet';
import { formatDayKst, formatDelta, formatKst, formatLapTime } from '../format';
import { IconBack } from '../icons';
import { appName } from '../brand';

type Other = { kind: 'lap'; lapNo: number } | { kind: 'ref'; id: string } | null;

const sectorText = (ms: number | null) => (ms === null ? '—' : ms < 60_000 ? (Math.floor(ms) / 1000).toFixed(3) : formatLapTime(ms, 3));

export function AnalysisScreen({ sessionId }: { sessionId: string }) {
  const { gMaxG } = useSettings();
  const [data, setData] = useState<AnalysisData | null | 'missing'>(null);
  const [lapA, setLapA] = useState<number | null>(null);
  const [other, setOther] = useState<Other>(null);
  const [otherProcessed, setOtherProcessed] = useState<ProcessedTrack | null>(null);
  const [chart, setChart] = useState<ChartKind>('speed');
  const [selS, setSelS] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // GPX는 원본 GPS 점으로 (원본이 정리됐으면 처리된 궤적으로). 공유 창은 탭 직후에만 열리므로 미리 읽어 둔다
  const [rawGps, setRawGps] = useState<GpsSample[] | null>(null);
  useEffect(() => {
    if (!exportOpen) return;
    let alive = true;
    void loadRaw(getRepo(), sessionId).then((r) => alive && setRawGps(r.gps));
    return () => {
      alive = false;
    };
  }, [exportOpen, sessionId]);

  useEffect(() => {
    let alive = true;
    void loadAnalysis(sessionId).then((d) => {
      if (!alive) return;
      if (!d) {
        setData('missing');
        return;
      }
      setData(d);
      const laps = d.result?.laps ?? [];
      const a = d.result?.bestLapNo ?? laps.find((l) => l.valid)?.lapNo ?? laps[0]?.lapNo ?? null;
      setLapA(a);
      // 비교 기본값: 이 코스의 다른 세션 베스트, 없으면 이 세션의 다음으로 빠른 유효 랩
      const ref = d.otherRefs[0];
      const second = laps.filter((l) => l.valid && l.lapNo !== a).sort((x, y) => x.lapTimeMs - y.lapTimeMs)[0];
      setOther(ref ? { kind: 'ref', id: ref.id } : second ? { kind: 'lap', lapNo: second.lapNo } : null);
    });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const d = data && data !== 'missing' ? data : null;
  const result = d?.result ?? null;
  const p = result?.processed ?? null;
  const lapRecA = result?.laps.find((l) => l.lapNo === lapA) ?? null;
  const refB = d && other?.kind === 'ref' ? (d.otherRefs.find((r) => r.id === other.id) ?? null) : null;
  const lapRecB = result && other?.kind === 'lap' ? (result.laps.find((l) => l.lapNo === other.lapNo) ?? null) : null;
  const traceB = refB?.trace ?? lapRecB?.trace ?? null;
  const labelB = refB ? `${formatDayKst(refB.startedAt)} 랩 ${refB.lapNo}` : lapRecB ? `랩 ${lapRecB.lapNo}` : null;

  useEffect(() => {
    let alive = true;
    setOtherProcessed(null);
    if (refB) void loadProcessedOf(refB.sessionId).then((x) => alive && setOtherProcessed(x));
    return () => {
      alive = false;
    };
  }, [refB?.sessionId]);

  const series = useMemo(() => (lapRecA ? compareSeries(lapRecA.trace, traceB) : null), [lapRecA, traceB]);

  // 지도: 랩 A는 속도 색칠, 랩 B는 점선 (같은 세션이면 이 궤적에서, 다른 세션이면 그 세션 결과가 폰에 있을 때)
  const lineA = useMemo(() => {
    if (!p) return null;
    const idx: number[] = [];
    for (let k = 0; k < p.n; k++) if (lapA === null ? true : p.lapNo[k] === lapA) idx.push(k);
    const sp = idx.map((k) => p.speed[k]!);
    const vMin = Math.min(...sp);
    const vMax = Math.max(...sp);
    return { pts: idx.map((k) => [p.lat[k]!, p.lon[k]!] as [number, number]), colors: sp.map((v) => speedColor(v, vMin, vMax)) };
  }, [p, lapA]);
  const lineB = useMemo(() => {
    const src = lapRecB ? p : refB ? otherProcessed : null;
    const no = lapRecB?.lapNo ?? refB?.lapNo;
    if (!src || no === undefined) return null;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < src.n; k++) if (src.lapNo[k] === no) pts.push([src.lat[k]!, src.lon[k]!]);
    return { pts, colorAll: '#c9cdd2' };
  }, [p, lapRecB, refB, otherProcessed]);

  const selK = p && lapA !== null && selS !== null ? lapPointAt(p, lapA, selS) : null;

  if (data === 'missing') {
    return (
      <main className="page page-full">
        <div className="empty">기록을 찾을 수 없습니다.</div>
        <a className="primary-btn" href="#/history">
          기록으로
        </a>
      </main>
    );
  }
  if (!d) return <main className="page page-full" aria-busy="true" />;
  const { session, course } = d;

  const exportFile = (kind: 'csv' | 'laps' | 'gpx', range: 'all' | 'lap') => {
    if (!result || !p) return;
    let file: File;
    if (kind === 'gpx') {
      const gps =
        rawGps && rawGps.length > 0
          ? rawGps.map((g) => ({ tFix: g.tFix, lat: g.lat, lon: g.lon, alt: g.alt, speed: g.speed }))
          : p.t.map((t, k) => ({ tFix: p.utc?.[k] ?? session.startedAt + t, lat: p.lat[k]!, lon: p.lon[k]!, alt: p.alt[k] ?? null, speed: p.speed[k]! }));
      const text = sessionToGpx({ name: course?.name ?? `${appName()} 주행`, gps });
      file = new File([text], csvFileName(course?.name ?? null, session.startedAt).replace(/\.csv$/, '.gpx'), { type: 'application/gpx+xml' });
    } else if (kind === 'laps') {
      file = new File([lapsCsv(result.laps)], csvFileName(course?.name ?? null, session.startedAt, 'laps'), { type: 'text/csv' });
    } else {
      const ref = refB ? { trace: refB.trace, lapTimeMs: refB.lapTimeMs } : lapRecB ? { trace: lapRecB.trace, lapTimeMs: lapRecB.lapTimeMs } : null;
      const text = sessionCsv({
        processed: p,
        startedAtEpochMs: session.startedAt,
        laps: result.laps,
        sectorBoundsM: course?.sectorBoundsM ?? null,
        lengthM: course?.lengthM ?? null,
        ref,
        range: range === 'lap' && lapA !== null ? { laps: [lapA], paddingS: 5 } : null,
      });
      file = new File([text], csvFileName(course?.name ?? null, session.startedAt), { type: 'text/csv' });
    }
    void shareOrDownload(file);
  };

  return (
    <main className="page page-full analysis">
      <header className="page-head">
        <a className="back-btn" href="#/history" aria-label="기록으로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1 }}>분석</h1>
        <button type="button" className="btn small" disabled={!result} onClick={() => setExportOpen(true)}>
          내보내기
        </button>
      </header>
      <span className="sub" style={{ marginTop: -8 }}>
        {formatKst(session.startedAt)} · {course?.name ?? '코스 없음'}
      </span>

      {!result && (
        <div className="notice">
          아직 계산하지 않은 기록이에요.{' '}
          <a href={`#/summary/${session.id}`} style={{ color: 'var(--accent)' }}>
            계산하기
          </a>
        </div>
      )}

      {result && (
        <div className="analysis-grid">
          <div className="card-col" style={{ gap: 12 }}>
            {result.laps.length > 0 ? (
              <section aria-label="랩 목록" className="lap-table">
                <div className="lap-row head five">
                  <span>랩</span>
                  <span>기록</span>
                  <span>구간 1·2·3</span>
                </div>
                {result.laps.map((l) => (
                  <button
                    key={l.lapNo}
                    type="button"
                    className={`lap-row five pick${l.lapNo === result.bestLapNo ? ' best' : ''}${l.valid ? '' : ' invalid'}`}
                    aria-pressed={l.lapNo === lapA}
                    onClick={() => {
                      setLapA(l.lapNo);
                      if (other?.kind === 'lap' && other.lapNo === l.lapNo) setOther(null);
                    }}
                  >
                    <span className="no">{l.lapNo}</span>
                    <span className="t">{formatLapTime(l.lapTimeMs, 3)}</span>
                    <span className="secs mono">{l.sectorTimesMs.map(sectorText).join(' · ')}</span>
                  </button>
                ))}
                <div className="lap-row five foot">
                  <span>이론</span>
                  <span className="t">{formatLapTime(result.theoreticalBest.totalMs, 3)}</span>
                  <span className="secs mono">{result.theoreticalBest.sectorsMs?.map(sectorText).join(' · ') ?? '—'}</span>
                </div>
              </section>
            ) : (
              <div className="notice">랩이 없는 기록이에요 (코스 없음). 지도와 내보내기만 볼 수 있어요.</div>
            )}

            {lapRecA && (
              <section className="card card-col" style={{ gap: 10 }} aria-label="두 랩 비교">
                <div className="compare-head">
                  <span>
                    <b className="a-dot" /> A 랩 {lapRecA.lapNo} <span className="mono">{formatLapTime(lapRecA.lapTimeMs, 3)}</span>
                  </span>
                  <label className="compare-b">
                    <span className="b-dot" /> B
                    <select
                      aria-label="비교할 랩 B"
                      value={other ? (other.kind === 'lap' ? `lap:${other.lapNo}` : `ref:${other.id}`) : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOther(v === '' ? null : v.startsWith('lap:') ? { kind: 'lap', lapNo: Number(v.slice(4)) } : { kind: 'ref', id: v.slice(4) });
                      }}
                    >
                      <option value="">없음</option>
                      {result.laps
                        .filter((l) => l.lapNo !== lapA)
                        .map((l) => (
                          <option key={l.lapNo} value={`lap:${l.lapNo}`}>
                            이 주행 랩 {l.lapNo} · {formatLapTime(l.lapTimeMs, 3)}
                          </option>
                        ))}
                      {d.otherRefs.map((r) => (
                        <option key={r.id} value={`ref:${r.id}`}>
                          {formatDayKst(r.startedAt)} 랩 {r.lapNo} · {formatLapTime(r.lapTimeMs, 3)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {labelB && traceB && (
                  <span className="sub">
                    A − B {formatDelta((lapRecA.lapTimeMs - (refB?.lapTimeMs ?? lapRecB!.lapTimeMs)) / 1000, 3)} ({labelB})
                  </span>
                )}
                <div className="segmented small" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} role="group" aria-label="그래프">
                  {(
                    [
                      ['speed', '속도'],
                      ['delta', '델타'],
                      ['alt', '고도'],
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={chart === k} disabled={k === 'delta' && !traceB} onClick={() => setChart(k)}>
                      {label}
                    </button>
                  ))}
                </div>
                {series && <CompareChart series={series} kind={chart === 'delta' && !traceB ? 'speed' : chart} selectedX={selS} onSelect={setSelS} />}
              </section>
            )}

            {p && selK !== null && (
              <section className="card point-info" aria-label="지점 정보">
                <span>
                  <span className="label">코스 거리</span> <span className="mono">{selS !== null ? `${Math.round(selS)} m` : '—'}</span>
                </span>
                <span>
                  <span className="label">속도</span> <span className="mono">{Math.round(p.speed[selK]! * 3.6)} km/h</span>
                </span>
                <span>
                  <span className="label">시간</span> <span className="mono">{lapRecA ? formatLapTime(p.t[selK]! - lapRecA.startT, 1) : '—'}</span>
                </span>
                <span>
                  <span className="label">고도</span> <span className="mono">{p.alt[selK] === null ? '—' : `${Math.round(p.alt[selK]!)} m`}</span>
                </span>
                <span className="wide">
                  <span className="label">위치</span>{' '}
                  <span className="mono">
                    {p.lat[selK]!.toFixed(6)}, {p.lon[selK]!.toFixed(6)}
                  </span>
                </span>
              </section>
            )}
          </div>

          <div className="card-col" style={{ gap: 12 }}>
            <AnalysisMap
              a={lineA}
              b={lineB}
              marker={selK !== null && p ? [p.lat[selK]!, p.lon[selK]!] : null}
              fitKey={`${session.id}:${lapA}`}
              onPick={(lat, lon) => {
                if (!p || lapA === null) return;
                const k = nearestLapPoint(p, lapA, lat, lon);
                if (k !== null && p.s[k] !== null && p.s[k] !== undefined) setSelS(p.s[k]!);
              }}
            />
            <span className="sub">지도: 랩 A 속도 색(느림 파랑 → 빠름 빨강), 랩 B 점선. 그래프나 지도를 누르면 그 지점을 보여줘요.</span>
            {p && lapA !== null && <GDiagram p={p} lapNo={lapA} selected={selK} max={gMaxG} />}
          </div>
        </div>
      )}

      <CalDiagnosisSection sessionId={session.id} />

      {exportOpen && (
        <ExportSheet sessionId={session.id} hasLap={lapA !== null} compareLabel={labelB} onClose={() => setExportOpen(false)} onExport={(k, r) => exportFile(k, r)} />
      )}
    </main>
  );
}

/** G 보정 진단 (실차 도구): G가 안 나왔을 때 어디서 막혔는지. 캡처해서 보내면 원인을 찾을 수 있다 */
function CalDiagnosisSection({ sessionId }: { sessionId: string }) {
  const [lines, setLines] = useState<DiagLine[] | 'loading' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setLines('loading');
    setError(null);
    loadCalDiagnosis(sessionId)
      .then((d) => setLines(calDiagnosisLines(d)))
      .catch((e: Error) => {
        setLines(null);
        setError(e.message);
      });
  };
  return (
    <section className="card card-col cal-diag" style={{ gap: 10 }} aria-label="G 보정 진단">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontWeight: 600 }}>G 보정 진단</span>
        <button type="button" className="btn small" disabled={lines === 'loading'} onClick={run}>
          {lines === 'loading' ? '보는 중…' : Array.isArray(lines) ? '다시 보기' : '보기'}
        </button>
      </div>
      {!Array.isArray(lines) && !error && <span className="sub">G가 안 나왔으면 눌러 보세요. 어느 단계에서 왜 막혔는지 보여줘요.</span>}
      {error && <div className="notice">{error}</div>}
      {Array.isArray(lines) && (
        <dl className="diag-lines">
          {lines.map((l) => (
            <div key={l.label} className={l.bad ? 'bad' : undefined}>
              <dt>{l.label}</dt>
              <dd>{l.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function ExportSheet({
  sessionId,
  hasLap,
  compareLabel,
  onClose,
  onExport,
}: {
  sessionId: string;
  hasLap: boolean;
  compareLabel: string | null;
  onClose: () => void;
  onExport: (k: 'csv' | 'laps' | 'gpx', r: 'all' | 'lap') => void;
}) {
  const [kind, setKind] = useState<'csv' | 'laps' | 'gpx' | 'raw'>('csv');
  const [range, setRange] = useState<'all' | 'lap'>('all');
  // 원본 파일은 만드는 데 시간이 걸려(서버에서 받을 수도) 미리 만든다. 공유 창은 탭 직후에만 열린다
  const [raw, setRaw] = useState<{ file: File | null; error: string | null }>({ file: null, error: null });
  useEffect(() => {
    if (kind !== 'raw' || raw.file) return;
    let alive = true;
    prepareRawExport(sessionId)
      .then((file) => alive && setRaw({ file, error: null }))
      .catch((e: Error) => alive && setRaw({ file: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [kind, sessionId, raw.file]);
  return (
    <Sheet title="내보내기" onClose={onClose}>
      <div className="segmented small" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="group" aria-label="형식">
        {(
          [
            ['csv', 'CSV'],
            ['laps', '랩 요약 CSV'],
            ['gpx', 'GPX'],
            ['raw', '원본 (PC에서 보기)'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      {kind === 'csv' && (
        <>
          <div className="segmented small" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="group" aria-label="범위">
            <button type="button" aria-pressed={range === 'all'} onClick={() => setRange('all')}>
              세션 전체
            </button>
            <button type="button" aria-pressed={range === 'lap'} disabled={!hasLap} onClick={() => setRange('lap')}>
              랩 A만 (앞뒤 5초)
            </button>
          </div>
          <span className="sub">델타(delta_s) 비교 랩: {compareLabel ?? '없음 (빈칸)'}. 영상 오버레이 프로그램(Telemetry Overlay 등)에서 바로 읽어요.</span>
        </>
      )}
      {kind === 'raw' && (
        <span className="sub">
          {raw.error ?? (raw.file ? 'PC의 같이타요(웹) 기록 탭에서 "원본 파일 가져오기"로 열면 같은 코스로 계산해서 보여줘요. 가져온 기록은 그 PC에만 저장돼요.' : '원본 파일을 만드는 중…')}
        </span>
      )}
      <button
        type="button"
        className="primary-btn"
        disabled={kind === 'raw' && !raw.file}
        onClick={() => {
          if (kind === 'raw') {
            if (raw.file) void shareOrDownload(raw.file);
          } else onExport(kind, range);
          onClose();
        }}
      >
        파일로 저장·공유
      </button>
    </Sheet>
  );
}
