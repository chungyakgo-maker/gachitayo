import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeScreen } from '../../src/ui/screens/HomeScreen';

describe('HomeScreen', () => {
  it('센서 기록 테스트 화면으로 가는 링크가 있다', () => {
    render(<HomeScreen />);
    expect(screen.getByRole('link', { name: '개발자: 센서 기록 테스트' })).toHaveAttribute(
      'href',
      '#/dev/recorder',
    );
  });
});
