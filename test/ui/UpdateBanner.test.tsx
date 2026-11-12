import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateBanner } from '../../src/ui/components/UpdateBanner';

describe('UpdateBanner', () => {
  it('새 버전이 없으면 아무것도 보이지 않는다', () => {
    const { container } = render(<UpdateBanner visible={false} onUpdate={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('새 버전이 있으면 안내와 업데이트 버튼을 보여준다', () => {
    render(<UpdateBanner visible onUpdate={() => {}} />);
    expect(screen.getByText('새 버전이 있습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '업데이트' })).toBeInTheDocument();
  });

  it('업데이트 버튼을 누르면 onUpdate를 한 번 부른다', async () => {
    const onUpdate = vi.fn();
    render(<UpdateBanner visible onUpdate={onUpdate} />);
    await userEvent.click(screen.getByRole('button', { name: '업데이트' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
