import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LongPressButton } from '../../src/ui/components/LongPressButton';

// 사용자 요청: "길게 눌러 주행 종료" 버튼을 1/3 크기로 줄여 [종료], 맨 아래 가운데
describe('종료 버튼 (사용자 요청)', () => {
  it('보이는 글자는 "종료", 화면 읽기 이름은 길게 누르라는 안내 그대로', () => {
    render(<LongPressButton onDone={() => {}} />);
    const btn = screen.getByRole('button', { name: '길게 눌러 종료 (1초)' });
    expect(btn).toHaveTextContent(/^종료$/);
  });
});
