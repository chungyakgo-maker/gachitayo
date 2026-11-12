import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/ui/App';
import { buildInfo } from '../../src/ui/buildInfo';
import { finishOnboarding } from '../../src/app/account';

describe('App', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('첫 실행: 닉네임과 안전 안내 확인 뒤 시작하면 메인 (서버 설정 전이면 폰에만 저장)', async () => {
    render(<App />);
    expect(screen.getByLabelText('닉네임')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: '시작하기' });
    expect(start).toBeDisabled();
    expect(screen.getByText(/서버 연결 전이라 기록을 폰에만/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '민수' } });
    expect(start).toBeDisabled(); // 안전 안내를 확인해야 한다
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeInTheDocument());
    expect(localStorage.getItem('gachitayo.nickname')).toBe('민수');
    // 메인: 앱 이름. 버전은 지도에 두지 않고 설정에만 (사용자 요청)
    expect(screen.getByRole('heading', { name: '같이타요' })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`버전 ${buildInfo.version} `))).not.toBeInTheDocument();
  });

  it('알 수 없는 경로는 메인으로 보여준다', async () => {
    await finishOnboarding('민수');
    window.location.hash = '#/no-such-screen';
    render(<App />);
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeInTheDocument();
  });
});
