// 도움말 · 기능 알아보기 화면 (설계 docs/superpowers/specs/2026-11-18-help-design.md, 시안 docs/mock/2026-11-18-help.jpg)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ teams: [] as unknown[], room: null as unknown }));
vi.mock('../../src/app/teams', async (orig) => ({ ...(await orig<typeof import('../../src/app/teams')>()), useTeams: () => ({ loaded: true, teams: h.teams }) }));
vi.mock('../../src/app/group', async (orig) => ({ ...(await orig<typeof import('../../src/app/group')>()), useGroup: () => ({ room: h.room }) }));

const { HelpScreen } = await import('../../src/ui/screens/HelpScreen');
const { HelpNudge, HELP_NUDGE_KEY } = await import('../../src/ui/components/HelpNudge');
const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');

const reduce = (on: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  h.teams = [];
  h.room = null;
  window.location.hash = '#/';
  Element.prototype.scrollIntoView = vi.fn();
  reduce(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('설정 › 도움말', () => {
  it('약관 위 "도움말"에 기능 알아보기 링크 (#/help)', () => {
    render(<SettingsScreen />);
    const sec = screen.getByRole('region', { name: '도움말' });
    expect(within(sec).getByRole('link', { name: /기능 알아보기/ })).toHaveAttribute('href', '#/help');
  });
});

describe('기능 알아보기 페이지', () => {
  it('처음 3단계와 카드 8장을 순서대로, 뒤로는 설정', () => {
    render(<HelpScreen />);
    expect(screen.getByRole('heading', { level: 1, name: '기능 알아보기' })).toBeInTheDocument();
    expect(screen.getByText('처음이세요? 3단계면 돼요')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((e) => e.textContent)).toEqual([
      '처음이세요? 3단계면 돼요',
      '코스 랩타이머 · 델타',
      '커브 표지판',
      '목적지로 주행',
      '코스 둘러보기',
      '팀 주행',
      '바이크 모드 · 기울기',
      '기록 · 분석',
      '화면 설정 · 지도',
    ]);
    expect(screen.getByRole('link', { name: '뒤로' })).toHaveAttribute('href', '#/settings');
  });

  it('칩을 누르면 그 카드로 (머리줄에 안 가리게 scrollIntoView)', () => {
    render(<HelpScreen />);
    fireEvent.click(screen.getByRole('button', { name: '커브 표지판' }));
    const card = document.getElementById('help-pace')!;
    expect(card.scrollIntoView).toHaveBeenCalled();
  });

  it('움직이는 그림은 GIF, 움직임 줄이기면 같은 이름 정지 그림 (alt는 카드 제목)', () => {
    const a = render(<HelpScreen />);
    expect(screen.getByRole('img', { name: '커브 표지판' })).toHaveAttribute('src', 'help/pace.gif');
    expect(screen.getByRole('img', { name: '목적지로 주행' })).toHaveAttribute('src', 'help/dest.jpg');
    a.unmount();
    reduce(true);
    render(<HelpScreen />);
    expect(screen.getByRole('img', { name: '커브 표지판' })).toHaveAttribute('src', 'help/pace.jpg');
  });

  it('바로 가기 링크, 위치 공유 설명은 없다', () => {
    const { container } = render(<HelpScreen />);
    expect(screen.getByRole('link', { name: /목적지 고르기/ })).toHaveAttribute('href', '#/destination');
    expect(container.textContent).not.toMatch(/위치 공유|앞 친구|친구 위치/);
  });
});

describe('메인: 처음 한 번 알림', () => {
  it('처음이면 보이고, "기능 알아보기"를 누르면 기억하고 #/help 로', () => {
    render(<HelpNudge />);
    expect(screen.getByText('디고 처음이세요?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '기능 알아보기' }));
    expect(localStorage.getItem(HELP_NUDGE_KEY)).toBe('1');
    expect(screen.queryByText('디고 처음이세요?')).toBeNull();
  });

  it('✕를 누르면 기억하고 사라진다. 기억돼 있으면 처음부터 없다', () => {
    const a = render(<HelpNudge />);
    fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }));
    expect(localStorage.getItem(HELP_NUDGE_KEY)).toBe('1');
    expect(screen.queryByText('디고 처음이세요?')).toBeNull();
    a.unmount();
    render(<HelpNudge />);
    expect(screen.queryByText('디고 처음이세요?')).toBeNull();
  });

  it('팀 주행 알림이나 방 알림이 떠 있으면 겹쳐 띄우지 않는다', () => {
    h.teams = [{ id: 't1', name: '북악 새벽팀', drive: { roomId: 'r', count: 2 } }];
    const a = render(<HelpNudge />);
    expect(screen.queryByText('디고 처음이세요?')).toBeNull();
    a.unmount();
    h.teams = [];
    h.room = { roomId: 'r' };
    render(<HelpNudge />);
    expect(screen.queryByText('디고 처음이세요?')).toBeNull();
  });
});
