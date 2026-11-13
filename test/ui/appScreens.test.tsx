import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 아이폰 앱 디고 (사양서 13.3): 첫 화면 안내, 개발자 메뉴, 개인정보처리방침·위치정보 이용약관
let app = false;
vi.mock('../../src/platform', () => ({ isApp: () => app }));
const openUrl = vi.fn(async (_o: unknown) => ({ completed: true }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: (o: unknown) => openUrl(o) } }));
// 서버가 있는 계정 화면 (서버 연결 전이면 다른 안내가 나온다)
vi.mock('../../src/app/account', async (orig) => {
  const real = await orig<typeof import('../../src/app/account')>();
  return { ...real, useAccount: () => ({ ...real.getAccountState(), status: 'none' as const }) };
});

const PRIVACY = 'https://chungyakgo-maker.github.io/gachitayo/privacy.html';
const LOCATION = 'https://chungyakgo-maker.github.io/gachitayo/location-terms.html';

async function welcome() {
  const { WelcomeScreen } = await import('../../src/ui/screens/WelcomeScreen');
  return render(<WelcomeScreen />);
}
async function settings() {
  const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
  return render(<SettingsScreen />);
}

describe('앱 화면 정리 (사양서 13.3)', () => {
  afterEach(() => {
    cleanup();
    app = false;
    openUrl.mockClear();
  });

  it('웹: 첫 화면에 "홈 화면에 추가" 안내, 설정에 개발자 메뉴 (지금 그대로)', async () => {
    await welcome();
    expect(screen.getByText('홈 화면에 추가')).toBeInTheDocument();
    cleanup();
    await settings();
    expect(screen.getByRole('region', { name: '개발자 메뉴' })).toBeInTheDocument();
  });

  it('앱: 첫 화면에 "홈 화면에 추가" 없음, 위치는 "항상 허용" 안내. 설정에 개발자 메뉴 없음', async () => {
    app = true;
    await welcome();
    expect(screen.queryByText('홈 화면에 추가')).toBeNull();
    expect(screen.getByText(/항상 허용/)).toBeInTheDocument();
    // 앱에는 브라우저가 없다
    expect(screen.queryByText(/브라우저 데이터/)).toBeNull();
    expect(screen.getByText(/앱을 지우거나 폰을 바꾸면/)).toBeInTheDocument();
    cleanup();
    await settings();
    expect(screen.queryByRole('region', { name: '개발자 메뉴' })).toBeNull();
  });

  it('웹·앱 공통: 첫 화면 동의 문구와 설정에 개인정보처리방침·위치정보 이용약관 (웹은 새 탭 링크)', async () => {
    await welcome();
    const agree = screen.getByRole('checkbox');
    expect(agree.closest('label')).toHaveTextContent('개인정보처리방침과 위치정보 이용약관에 동의합니다');
    expect(screen.getByRole('link', { name: '개인정보처리방침' })).toHaveAttribute('href', PRIVACY);
    expect(screen.getByRole('link', { name: '위치정보 이용약관' })).toHaveAttribute('href', LOCATION);
    cleanup();
    await settings();
    expect(screen.getByRole('link', { name: '개인정보처리방침' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: '위치정보 이용약관' })).toHaveAttribute('href', LOCATION);
  });

  it('앱: 약관 링크는 앱 밖(사파리)으로 연다', async () => {
    app = true;
    await settings();
    fireEvent.click(screen.getByRole('link', { name: '개인정보처리방침' }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith({ url: PRIVACY }));
  });
});
