// 기울기 0점·기울기 시험 화면 (2026-11-19 세영 "기울기가 부정확해 웹에서 테스트하게 … 0에서도 기울기 동작하게끔해")
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  phase: 'idle' as string,
  snap: null as unknown,
  zeroOk: true,
  fused: true,
}));
vi.mock('../../src/features', async (orig) => ({
  ...(await orig<typeof import('../../src/features')>()),
  leanFused: () => h.fused,
}));
vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  useDrive: () => ({ phase: h.phase, replay: null, courses: [] }),
  useLiveSnapshot: () => h.snap,
  zeroLean: () => (h.calls.push('zero'), h.zeroOk),
  beginPrepare: () => {
    h.calls.push('prepare');
    h.phase = 'preparing';
    window.location.hash = '#/prepare';
  },
  cancelPrepare: async () => void h.calls.push('cancel'),
}));

const { LeanTestScreen } = await import('../../src/ui/screens/LeanTestScreen');
const { LeanZeroCard, formatLean } = await import('../../src/ui/components/LeanZeroCard');

const snapWith = (lean: unknown, speedKmh = 23) => ({ t: 1, state: { speedKmh }, lean });

beforeEach(() => {
  cleanup();
  h.calls = [];
  h.phase = 'idle';
  h.snap = null;
  h.zeroOk = true;
  h.fused = true;
  window.location.hash = '#/dev/lean';
});

describe('기울기 글자', () => {
  it('오른쪽 + · 왼쪽 − · 0', () => {
    expect(formatLean(12.4)).toBe('오른쪽 12°');
    expect(formatLean(-3.6)).toBe('왼쪽 4°');
    expect(formatLean(0.3)).toBe('0°');
  });
});

describe('기울기 시험 화면 (#/dev/lean)', () => {
  it('준비 전: "시험 시작"을 누르면 주행 준비를 열고(센서 켜기) 이 화면에 머문다', () => {
    render(<LeanTestScreen />);
    fireEvent.click(screen.getByRole('button', { name: '시험 시작' }));
    expect(h.calls).toEqual(['prepare']);
    expect(window.location.hash).toBe('#/dev/lean');
  });

  it('센서 기울기·최종은 바늘 그림(최대 왼쪽·오른쪽), 계산 기울기·속도·0점은 글자, 0점 맞추기·시험 끝내기', () => {
    h.phase = 'preparing';
    h.snap = snapWith({ deg: 9.2, tiltDeg: 12.1, physicsDeg: -2.9, ref: 'user' });
    const { rerender } = render(<LeanTestScreen />);
    expect(screen.getByRole('img', { name: '센서 기울기 오른쪽 12도 (최대 왼쪽 0도, 오른쪽 12도)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '최종 기울기 오른쪽 9도 (최대 왼쪽 0도, 오른쪽 9도)' })).toBeInTheDocument();
    // 왼쪽으로 기울이면 최대 왼쪽이 남는다
    h.snap = snapWith({ deg: -20, tiltDeg: -21, physicsDeg: 0, ref: 'user' });
    rerender(<LeanTestScreen />);
    expect(screen.getByRole('img', { name: '센서 기울기 왼쪽 21도 (최대 왼쪽 21도, 오른쪽 12도)' })).toBeInTheDocument();
    h.snap = snapWith({ deg: 9.2, tiltDeg: 12.1, physicsDeg: -2.9, ref: 'user' });
    rerender(<LeanTestScreen />);
    const rows = screen.getByRole('list', { name: '기울기 값' });
    expect(within(rows).getByText('계산 기울기').parentElement).toHaveTextContent('왼쪽 3°');
    expect(within(rows).getByText('속도').parentElement).toHaveTextContent('23 km/h');
    expect(within(rows).getByText('0점').parentElement).toHaveTextContent('직접 맞춤');
    fireEvent.click(screen.getByRole('button', { name: '0점 맞추기' }));
    expect(screen.getByText('0점을 맞췄어요')).toBeInTheDocument();
    // 0점을 새로 맞추면 최대값도 처음부터
    expect(screen.getByRole('img', { name: '센서 기울기 오른쪽 12도 (최대 왼쪽 0도, 오른쪽 12도)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '시험 끝내기' }));
    expect(h.calls).toEqual(['zero', 'cancel']);
  });

  it('센서 값이 아직 없으면 0점을 못 맞춘다고 알린다', () => {
    h.phase = 'preparing';
    h.zeroOk = false;
    h.snap = snapWith({ deg: 0, tiltDeg: 0, physicsDeg: 0, ref: 'none' });
    render(<LeanTestScreen />);
    fireEvent.click(screen.getByRole('button', { name: '0점 맞추기' }));
    expect(screen.getByText('센서 값이 아직 없어요. 주행 시작에서 동작 센서를 허락했는지 보고 잠시 뒤 다시 눌러 주세요')).toBeInTheDocument();
  });

  it('합치기가 꺼진 빌드(앱)에서는 웹에서만 된다고 알린다', () => {
    h.phase = 'preparing';
    h.fused = false;
    h.snap = { t: 1, state: null };
    render(<LeanTestScreen />);
    expect(screen.getByText('기울기 시험은 웹에서만 할 수 있어요')).toBeInTheDocument();
  });

  it('웹인데 센서 값이 아직 없으면 기다린다고 알린다 (웹에서만이라고 하지 않는다)', () => {
    h.phase = 'preparing';
    h.snap = { t: 1, state: null, lean: null };
    render(<LeanTestScreen />);
    expect(screen.getByText('센서 값을 기다리는 중이에요. 주행 시작에서 동작 센서를 허락했는지 확인해 주세요')).toBeInTheDocument();
    expect(screen.queryByText('기울기 시험은 웹에서만 할 수 있어요')).toBeNull();
  });
});

describe('주행 준비 › 기울기 0점 카드', () => {
  it('지금 기울기·0점 기준·0점 맞추기·시험 화면 링크', () => {
    h.phase = 'preparing';
    h.snap = snapWith({ deg: -4, tiltDeg: -4, physicsDeg: 0, ref: 'still' }, 0);
    render(<LeanZeroCard />);
    const card = screen.getByRole('region', { name: '기울기 0점' });
    expect(card).toHaveTextContent('지금 왼쪽 4°');
    expect(card).toHaveTextContent('정차 자세 기준이에요. 바이크를 똑바로 세우고 0점을 맞추면 더 정확해요');
    fireEvent.click(within(card).getByRole('button', { name: '0점 맞추기' }));
    expect(h.calls).toEqual(['zero']);
    expect(within(card).getByRole('link', { name: '기울기 시험 보기 ›' })).toHaveAttribute('href', '#/dev/lean');
  });

  it('합치기가 꺼진 빌드(앱)면 아무것도 안 그린다', () => {
    h.phase = 'preparing';
    h.fused = false;
    h.snap = { t: 1, state: null };
    const { container } = render(<LeanZeroCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('웹인데 센서 값이 아직 없으면 기다리는 중', () => {
    h.phase = 'preparing';
    h.snap = { t: 1, state: null, lean: null };
    render(<LeanZeroCard />);
    expect(screen.getByRole('region', { name: '기울기 0점' })).toHaveTextContent('센서 값을 기다리는 중이에요');
  });
});
