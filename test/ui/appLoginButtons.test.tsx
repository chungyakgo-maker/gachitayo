import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 아이폰 앱 첫 화면·설정의 카카오·Apple 로그인 버튼 (앱 로그인 설계 2026-11-17)
const API = 'https://gachitayo-api.example.workers.dev';
const h = vi.hoisted(() => ({ app: true, apple: vi.fn(async () => ({ ok: false, cancelled: true }) as { ok: boolean; cancelled?: true; error?: string }) }));
vi.mock('../../src/platform', async (orig) => ({ ...(await orig<typeof import('../../src/platform')>()), isApp: () => h.app }));
vi.mock('../../src/app/appleLogin', () => ({ startAppleLogin: () => h.apple(), setAfterAppleLogin: () => {} }));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  cleanup();
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv('VITE_API_URL', API);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (String(url).endsWith('/auth/providers') ? json(200, { kakao: true, apple: true }) : json(404, {}))),
  );
  h.app = true;
  h.apple.mockReset().mockResolvedValue({ ok: false, cancelled: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('첫 화면', () => {
  it('앱: 카카오로 시작하기와 Apple로 계속하기, 안전 안내에 체크해야 눌린다', async () => {
    const { WelcomeScreen } = await import('../../src/ui/screens/WelcomeScreen');
    render(<WelcomeScreen />);
    const apple = await screen.findByRole('button', { name: 'Apple로 계속하기' });
    expect(screen.getByRole('button', { name: '카카오로 시작하기' })).toBeInTheDocument();
    expect(apple).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(apple);
    await waitFor(() => expect(h.apple).toHaveBeenCalled());
  });

  it('카카오 로그인 창을 닫으면 버튼을 다시 누를 수 있다', async () => {
    const k = await import('../../src/app/kakaoLogin');
    vi.spyOn(k, 'startKakaoLogin').mockResolvedValue('cancelled');
    const { WelcomeScreen } = await import('../../src/ui/screens/WelcomeScreen');
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('checkbox'));
    const btn = await screen.findByRole('button', { name: '카카오로 시작하기' });
    fireEvent.click(btn);
    await waitFor(() => expect(k.startKakaoLogin).toHaveBeenCalled());
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it('애플 로그인이 실패하면 그 말을 보여 준다', async () => {
    h.apple.mockResolvedValueOnce({ ok: false, error: '애플 로그인을 확인하지 못했어요. 다시 시도해 주세요' });
    const { WelcomeScreen } = await import('../../src/ui/screens/WelcomeScreen');
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Apple로 계속하기' }));
    expect(await screen.findByText('애플 로그인을 확인하지 못했어요. 다시 시도해 주세요')).toBeInTheDocument();
  });

  it('웹: Apple 버튼은 없다', async () => {
    h.app = false;
    const { WelcomeScreen } = await import('../../src/ui/screens/WelcomeScreen');
    render(<WelcomeScreen />);
    await screen.findByRole('button', { name: '카카오로 시작하기' });
    expect(screen.queryByRole('button', { name: 'Apple로 계속하기' })).toBeNull();
  });
});

describe('설정 계정 칸', () => {
  function ready(extra: Record<string, string> = {}) {
    localStorage.setItem('gachitayo.token', 't'.repeat(43));
    localStorage.setItem('gachitayo.userId', 'u1');
    localStorage.setItem('gachitayo.nickname', '민수');
    localStorage.setItem('gachitayo.onboarded', '1');
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
  }

  it('익명 계정: 카카오로 로그인 + Apple로 로그인', async () => {
    ready();
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Apple로 로그인' }));
    expect(screen.getByRole('button', { name: '카카오로 로그인' })).toBeInTheDocument();
    await waitFor(() => expect(h.apple).toHaveBeenCalled());
  });

  it('Apple로 연결된 계정: "Apple 연결됨"과 로그아웃, Apple 로그인 버튼은 없다', async () => {
    ready({ 'gachitayo.apple': '1' });
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    expect(await screen.findByText('Apple 연결됨')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apple로 로그인' })).toBeNull();
    expect(screen.getByText(/Apple 계정에 연결돼 있어요/)).toBeInTheDocument();
  });

  it('Apple만 연결된 계정은 "카카오도 연결하기"를 보여 준다 (웹에서도 들어오게)', async () => {
    ready({ 'gachitayo.apple': '1' });
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    expect(await screen.findByRole('button', { name: '카카오도 연결하기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apple도 연결하기' })).toBeNull();
  });

  it('카카오·애플 둘 다 연결: "카카오 · Apple 연결됨"', async () => {
    ready({ 'gachitayo.apple': '1', 'gachitayo.kakao': '1' });
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    expect(await screen.findByText('카카오 · Apple 연결됨')).toBeInTheDocument();
  });
});
