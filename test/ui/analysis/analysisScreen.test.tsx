import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors } from '../../generators';
import { processDrive } from '../../../src/engine/process/processDrive';
import type { AnalysisData } from '../../../src/app/analysis';

const truth = simulateDrive(stadiumTrack(), { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });
const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed: 41 });
const r = processDrive({ gps: s.gps, motion: s.motion, events: [{ t: 0, type: 'start' }], course: null, startedAtEpochMs: s.startedAtEpochMs });
const data: AnalysisData = {
  session: { id: 's1', courseId: r.course!.id, courseVersion: 1, status: 'processed', startedAt: s.startedAtEpochMs, endedAt: null, device: { os: 'x', browser: 'y', userAgent: 'z', standalone: false }, calibration: null, summary: null },
  result: {
    sessionId: 's1',
    courseId: r.course!.id,
    courseVersion: 1,
    processedAt: 0,
    laps: r.laps,
    theoreticalBest: r.theoreticalBest,
    bestLapNo: r.bestLap!.lapNo,
    processed: r.processed,
    fusion: { gpsOnly: false, speedQualityLow: false, axisSigns: { accel: 1, gyro: 1, confidence: 'high' } },
    proposedCourse: null,
    previousBestMs: null,
  },
  course: { ...r.course!, name: '오벌' },
  otherRefs: [],
};
vi.mock('../../../src/app/analysis', () => ({ loadAnalysis: async () => data, loadProcessedOf: async () => null }));
const share = vi.fn(async (_f: File) => 'downloaded' as const);
vi.mock('../../../src/storage/exportFile', async (orig) => ({ ...(await orig<typeof import('../../../src/storage/exportFile')>()), shareOrDownload: (f: File) => share(f) }));

vi.mock('../../../src/app/rawTransfer', async (orig) => {
  const { diagnoseCalibration } = await import('../../../src/engine/diagnose/calibration');
  return { ...(await orig<typeof import('../../../src/app/rawTransfer')>()), loadCalDiagnosis: async () => diagnoseCalibration(s.gps, s.motion) };
});

const { AnalysisScreen } = await import('../../../src/ui/screens/AnalysisScreen');

describe('분석 화면 (사양서 8.6)', () => {
  it('랩 목록(베스트 표시·이론상 베스트), 랩 A 기본은 베스트, 비교 B는 다음으로 빠른 랩', async () => {
    render(<AnalysisScreen sessionId="s1" />);
    const list = await screen.findByRole('region', { name: '랩 목록' });
    expect(list).toHaveTextContent('이론');
    const best = screen.getAllByRole('button', { pressed: true }).find((b) => b.classList.contains('pick'))!;
    expect(best).toHaveTextContent(String(r.bestLap!.lapNo));
    const b = screen.getByRole('combobox', { name: '비교할 랩 B' }) as HTMLSelectElement;
    expect(b.value).toMatch(/^lap:\d+$/);
    expect(screen.getByRole('region', { name: '두 랩 비교' })).toHaveTextContent('A − B');
  });

  it('다른 랩을 누르면 랩 A가 바뀌고, 비교를 없애면 델타 그래프는 고를 수 없다', async () => {
    render(<AnalysisScreen sessionId="s1" />);
    await screen.findByRole('region', { name: '랩 목록' });
    const other = r.laps.find((l) => l.lapNo !== r.bestLap!.lapNo)!;
    fireEvent.click(screen.getAllByRole('button').find((x) => x.classList.contains('pick') && x.textContent?.startsWith(String(other.lapNo)))!);
    expect(screen.getByRole('region', { name: '두 랩 비교' })).toHaveTextContent(`A 랩 ${other.lapNo}`);
    fireEvent.change(screen.getByRole('combobox', { name: '비교할 랩 B' }), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '델타' })).toBeDisabled();
  });

  it('내보내기: CSV(세션 전체)를 파일로', async () => {
    render(<AnalysisScreen sessionId="s1" />);
    await screen.findByRole('region', { name: '랩 목록' });
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    expect(screen.getByRole('dialog', { name: '내보내기' })).toHaveTextContent('Telemetry Overlay');
    fireEvent.click(screen.getByRole('button', { name: '파일로 저장·공유' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const f = share.mock.calls[0]![0];
    expect(f.name).toMatch(/^gachitayo_오벌_\d{8}-\d{4}\.csv$/);
    expect((await f.text()).split('\n')[0]).toMatch(/^utc_time,elapsed_s,lap,/);
  });

  it('G 보정 진단: 보기를 누르면 결과·센서·GPS·정차·직진 가감속 줄을 보여준다', async () => {
    render(<AnalysisScreen sessionId="s1" />);
    const box = await screen.findByRole('region', { name: 'G 보정 진단' });
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    await waitFor(() => expect(box).toHaveTextContent(/보정 끝 \(출발 \d+초 뒤\)/));
    for (const label of ['동작 센서', 'GPS', '1 정차', '2 직진 가감속', '단계 시각']) expect(box).toHaveTextContent(label);
    expect(screen.getByRole('button', { name: '다시 보기' })).toBeEnabled();
  });
});
