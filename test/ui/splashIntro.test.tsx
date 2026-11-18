// 아이폰 앱 실행 화면 애니메이션 2초 (사용자 요청 2026-11-18, 디자인 캔버스 '로고' 페이지 DgoSplash 확정 시안 그대로, 아이폰 앱만):
// 차 세 대가 화면 밖에서 D·G·O로 들어오고, 핀이 떨어져 O에 꽂혀 흔들리고, "드라이브 갈 땐"이 나타난 뒤 메인 화면으로
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { splashFrame, SPLASH_MS } from '../../src/ui/splash/splashFrame';

const rot = (tf: string) => Number(/rotate\(([-\d.]+)\)/.exec(tf)![1]);
const at = (tf: string) => (/translate\(([-\d.]+) ([-\d.]+)\)/.exec(tf)!.slice(1).map(Number));

describe('실행 화면 움직임 (시안 시간표)', () => {
  it('2초짜리, 처음에는 아무것도 안 보이고 글자는 조금 작게', () => {
    expect(SPLASH_MS).toBe(2000);
    const f = splashFrame(0);
    expect(f.roadOpacity).toBe(0);
    expect(f.pinOpacity).toBe(0);
    expect(f.tagOpacity).toBe(0);
    expect(f.introScale).toBeCloseTo(0.94, 6);
  });

  it('끝 장면은 확정 아이콘과 같은 자리·방향 (차 D 126.7,225 150° · G 174.7,234.8 200° · O 349.2,299.8 −45°, 핀은 제자리)', () => {
    const f = splashFrame(2000);
    expect(f.roadOpacity).toBe(1);
    expect(f.introScale).toBeCloseTo(1, 6);
    expect(at(f.carA)).toEqual([126.7, 225]);
    expect(rot(f.carA)).toBeCloseTo(150, 0);
    expect(at(f.carB)).toEqual([174.7, 234.8]);
    expect(((rot(f.carB) % 360) + 360) % 360).toBeCloseTo(200, 0);
    expect(at(f.carC)).toEqual([349.2, 299.8]);
    expect(rot(f.carC)).toBeCloseTo(-45, 0);
    expect(f.pinDy).toBeCloseTo(0, 6);
    expect(f.pinOpacity).toBe(1);
    expect(f.oTf).toBe('');
    expect(f.tagOpacity).toBe(1);
  });

  it('차는 화면 밖에서 시작 (주황은 왼쪽 밖, 남색은 아래쪽 밖, 노랑은 오른쪽 밖)', () => {
    expect(at(splashFrame(0).carA)[0]).toBeLessThan(0);
    expect(at(splashFrame(0).carB)[1]).toBeGreaterThan(800);
    expect(at(splashFrame(0).carC)[0]).toBeGreaterThan(512);
  });

  it('핀은 0.9초부터 떨어져 1.175초에 O에 닿고, 그때부터 O가 흔들리다 멈춘다. "드라이브 갈 땐"은 1.2~1.6초', () => {
    expect(splashFrame(899).pinOpacity).toBe(0);
    expect(splashFrame(1000).pinDy).toBeLessThan(-50);
    expect(Math.abs(splashFrame(1175).pinDy)).toBeLessThan(1);
    expect(splashFrame(1174).oTf).toBe('');
    expect(splashFrame(1250).oTf).toMatch(/rotate\(/);
    expect(splashFrame(1199).tagOpacity).toBe(0);
    expect(splashFrame(1600).tagOpacity).toBe(1);
  });
});

describe('실행 화면 (아이폰 앱)', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('그림(도로 DGO·차·핀·문구)을 보여 주고 2초 뒤 끝난다', async () => {
    vi.useFakeTimers();
    const { SplashIntro } = await import('../../src/ui/components/SplashIntro');
    const done = vi.fn();
    render(<SplashIntro onDone={done} />);
    expect(screen.getByRole('img', { name: /DGO 실행 화면/ })).toBeInTheDocument();
    expect(screen.getByText('드라이브 갈 땐')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SPLASH_MS - 50));
    expect(done).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('동작 줄이기를 켠 사람에게는 움직임 없이 끝 장면만 잠깐', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    const { SplashIntro } = await import('../../src/ui/components/SplashIntro');
    const done = vi.fn();
    const { container } = render(<SplashIntro onDone={done} />);
    // 끝 장면: 문구가 다 보인다
    expect((screen.getByText('드라이브 갈 땐') as HTMLElement).style.opacity).toBe('1');
    expect(container.querySelector('[data-splash]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(900));
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('앱을 켤 때 한 번 (아이폰 앱만, 사용자 결정)', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.doUnmock('../../src/platform');
    vi.resetModules();
  });
  const mount = async (app: boolean) => {
    vi.resetModules();
    vi.doMock('../../src/platform', async (orig) => ({ ...(await orig<typeof import('../../src/platform')>()), isApp: () => app }));
    const { App } = await import('../../src/ui/App');
    return render(<App />);
  };

  it('아이폰 앱: 켜면 실행 화면이 위에 덮이고 끝나면 사라진다', async () => {
    vi.useFakeTimers();
    await mount(true);
    expect(screen.getByRole('img', { name: /DGO 실행 화면/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.queryByRole('img', { name: /DGO 실행 화면/ })).toBeNull();
  });

  it('웹: 실행 화면 없음', async () => {
    await mount(false);
    expect(screen.queryByRole('img', { name: /DGO 실행 화면/ })).toBeNull();
  });
});
