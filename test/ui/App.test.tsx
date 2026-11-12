import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/ui/App';

describe('App', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('홈 화면에 앱 이름과 버전을 보여준다', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '같이타요' })).toBeInTheDocument();
    expect(screen.getByText(/버전 local/)).toBeInTheDocument();
  });

  it('알 수 없는 경로는 홈 화면으로 보여준다', () => {
    window.location.hash = '#/no-such-screen';
    render(<App />);
    expect(screen.getByRole('heading', { name: '같이타요' })).toBeInTheDocument();
  });
});
