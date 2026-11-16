import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SummaryView } from '../../src/ui/screens/SummaryScreen';
import type { DriveResultRecord } from '../../src/types/drive';
import type { Course } from '../../src/types/course';
import type { DriveLap } from '../../src/engine/process/processDrive';

const lap = (lapNo: number, ms: number, valid = true, invalidReason: DriveLap['invalidReason'] = null): DriveLap => ({
  lapNo,
  startT: 0,
  endT: ms,
  lapTimeMs: ms,
  sectorTimesMs: [1, 2, 3],
  valid,
  invalidReason,
  maxSpeed: 40,
  distanceM: 1000,
  trace: { stepM: 5, t: [], v: [], alt: [] },
});
const course: Course = {
  id: 'c1',
  name: '인제 풀코스',
  kind: 'loop',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  startGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  finishGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  centerline: [
    [37.2, 127.1],
    [37.201, 127.1],
  ],
  lengthM: 3900,
  sectorBoundsM: [1300, 2600],
  version: 1,
};
const result = (p: Partial<DriveResultRecord> = {}): DriveResultRecord => ({
  sessionId: 's',
  courseId: 'c1',
  courseVersion: 1,
  processedAt: 0,
  laps: [lap(1, 128_774), lap(2, 123_871), lap(3, 131_060, false, 'gps_lost')],
  theoreticalBest: { sectorsMs: [1, 2, 3], totalMs: 123_838 },
  bestLapNo: 2,
  processed: { hz: 10, n: 0, t: [], lat: [], lon: [], alt: [], speed: [], heading: [], ax: [], ay: [], s: [], lapNo: [] },
  fusion: { gpsOnly: false, speedQualityLow: false, axisSigns: { accel: 1, gyro: 1, confidence: 'high' } },
  proposedCourse: null,
  previousBestMs: 124_318,
  ...p,
});
const session = { id: 's', courseId: 'c1', courseVersion: 1, status: 'processed' as const, startedAt: Date.now(), endedAt: Date.now(), device: { os: '', browser: '', userAgent: '', standalone: true }, calibration: null, summary: null };
const noop = () => {};

describe('주행 종료 요약 (사양서 8.5, 시안 Summary)', () => {
  it('베스트 랩, 개인 기록 갱신, 이론상 베스트, 유효 랩, 랩 표(베스트 강조·무효 사유)', () => {
    render(<SummaryView data={{ session, result: result(), course }} busy={false} error={null} onRetry={noop} onKind={noop} onSave={noop} />);
    expect(screen.getByText(/오늘 · 인제 풀코스 · 3랩/)).toBeInTheDocument();
    expect(screen.getByText('베스트 랩 · 랩 2')).toBeInTheDocument();
    expect(screen.getAllByText('2:03.871').length).toBeGreaterThan(0);
    expect(screen.getByText(/개인 기록 갱신/)).toHaveTextContent('−0.447');
    expect(screen.getByText('2:03.838')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('+4.903')).toBeInTheDocument();
    expect(screen.getByText('무효 · GPS 끊김')).toBeInTheDocument();
    expect(screen.getByText('베스트')).toBeInTheDocument();
  });

  it('첫 주행: 새 코스 저장 폼 (종류 바꾸기, 이름 넣고 저장)', () => {
    const onSave = vi.fn();
    const onKind = vi.fn();
    render(
      <SummaryView
        data={{ session: { ...session, courseId: null }, result: result({ courseId: null, courseVersion: null, proposedCourse: course, previousBestMs: null }), course: null }}
        busy={false}
        error={null}
        onRetry={noop}
        onKind={onKind}
        onSave={onSave}
      />,
    );
    expect(screen.getByText('새 코스로 저장할까요?')).toBeInTheDocument();
    expect(screen.getByText('출발점으로 돌아와서 랩 코스로 감지했어요')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '편도 구간' }));
    expect(onKind).toHaveBeenCalledWith('point_to_point');
    fireEvent.change(screen.getByLabelText('코스 이름'), { target: { value: '우리 동네' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledWith('우리 동네');
  });

  it('계산 중 표시, 오류면 다시 계산', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<SummaryView data={{ session, result: null, course: null }} busy error={null} onRetry={onRetry} onKind={noop} onSave={noop} />);
    expect(screen.getByText('주행 기록을 계산하는 중…')).toBeInTheDocument();
    rerender(<SummaryView data={{ session, result: null, course: null }} busy={false} error="GPS 기록이 없어" onRetry={onRetry} onKind={noop} onSave={noop} />);
    fireEvent.click(screen.getByRole('button', { name: '다시 계산' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

// 벗어난 길 저장 (설계 docs/superpowers/specs/2026-11-13-off-course-design.md): 기본 코스는 새 코스로만, 내 코스는 덮어쓰기도
describe('요약: 코스를 벗어난 길', () => {
  const detour: Course = { ...course, id: 'd1', name: '', lengthM: 4600 };
  const props = () => ({ busy: false, error: null, onRetry: vi.fn(), onKind: vi.fn(), onSave: vi.fn(), onDetourNew: vi.fn(), onDetourOverwrite: vi.fn(), onDetourDismiss: vi.fn() });

  it('내 코스: 새 코스로 저장과 지금 코스 덮어쓰기(한 번 더 확인)를 보인다', () => {
    const p = props();
    render(<SummaryView {...p} data={{ session, result: result({ offCourseM: 640, detourCourse: detour }), course }} />);
    expect(screen.getByText('코스를 벗어난 길로 달렸어요')).toBeInTheDocument();
    expect(screen.getByText(/코스를 벗어나 달린 거리 640 m/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('새 코스 이름'), { target: { value: '인제 우회' } });
    fireEvent.click(screen.getByRole('button', { name: '새 코스로 저장' }));
    expect(p.onDetourNew).toHaveBeenCalledWith('인제 우회');
    fireEvent.click(screen.getByRole('button', { name: '지금 코스 덮어쓰기' }));
    expect(p.onDetourOverwrite).not.toHaveBeenCalled();
    expect(screen.getByText(/'인제 풀코스' 코스를 이 길로 바꿀까요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '덮어쓰기' }));
    expect(p.onDetourOverwrite).toHaveBeenCalledTimes(1);
  });

  it('기본 코스: 덮어쓰기 없이 새 코스로만', () => {
    render(<SummaryView {...props()} data={{ session, result: result({ offCourseM: 640, detourCourse: detour }), course: { ...course, builtin: 'baehuryeong' } }} />);
    expect(screen.getByRole('button', { name: '새 코스로 저장' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '지금 코스 덮어쓰기' })).toBeNull();
  });

  it('안 함을 누르면 닫기를 부르고, 제안이 없으면 카드가 없다', () => {
    const p = props();
    const { unmount } = render(<SummaryView {...p} data={{ session, result: result({ offCourseM: 640, detourCourse: detour }), course }} />);
    fireEvent.click(screen.getByRole('button', { name: '안 함' }));
    expect(p.onDetourDismiss).toHaveBeenCalledTimes(1);
    unmount();
    render(<SummaryView {...props()} data={{ session, result: result(), course }} />);
    expect(screen.queryByText('코스를 벗어난 길로 달렸어요')).toBeNull();
  });
});
