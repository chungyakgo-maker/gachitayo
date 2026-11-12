import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/ui/App';
import { buildInfo } from '../../src/ui/buildInfo';

describe('App', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('홈 화면에 앱 이름과 버전을 보여준다', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '같이타요' })).toBeInTheDocument();
    // 버전은 빌드 환경마다 다르다 (Actions: 커밋 앞 7자리, 그 밖: local)
    expect(screen.getByText(new RegExp(`버전 ${buildInfo.version} `))).toBeInTheDocument();
  });

  it('알 수 없는 경로는 홈 화면으로 보여준다', () => {
    window.location.hash = '#/no-such-screen';
    render(<App />);
    expect(screen.getByRole('heading', { name: '같이타요' })).toBeInTheDocument();
  });
});
