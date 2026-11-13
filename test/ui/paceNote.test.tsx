import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaceNoteSign } from '../../src/ui/components/PaceNoteSign';
import { PaceNoteTile } from '../../src/ui/components/PaceNoteHud';
import type { PaceNote } from '../../src/engine/course/paceNotes';

const note = (p: Partial<PaceNote>): PaceNote => ({ s0: 100, s1: 150, dir: 'left', grade: 3, mod: null, angleDeg: 80, radiusM: 40, ...p });

describe('커브 표지판 (사양서 8.4, 시안)', () => {
  it('왼쪽은 연한 파랑, 숫자는 위쪽 정가운데', () => {
    const { container } = render(<PaceNoteSign dir="left" grade={3} />);
    const svg = screen.getByRole('img', { name: '왼쪽 3' });
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('#aacae6');
    const text = container.querySelector('text')!;
    expect(text.textContent).toBe('3');
    expect(text.getAttribute('x')).toBe('50');
    expect(text.getAttribute('text-anchor')).toBe('middle');
    expect(svg.querySelector('path')!.getAttribute('d')).toMatch(/^M/);
  });

  it('오른쪽은 연한 빨강, 헤어핀은 숫자 자리에 이름, 붙는 말은 화면 읽기 이름에', () => {
    const { container } = render(<PaceNoteSign dir="right" grade="H" mod="조여짐" />);
    const svg = screen.getByRole('img', { name: '오른쪽 헤어핀 조여짐' });
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('#f4a7a3');
    expect(container.querySelector('text')!.textContent).toBe('헤어핀');
  });

  it('등급마다 화살표가 다르게 꺾인다 (6과 1의 화살표가 같지 않다)', () => {
    const a = render(<PaceNoteSign dir="left" grade={6} />).container.querySelector('path')!.getAttribute('d');
    const b = render(<PaceNoteSign dir="left" grade={1} />).container.querySelector('path')!.getAttribute('d');
    expect(a).not.toBe(b);
  });

  it('표지판 칸: 큰 표지판 + 남은 거리 + 이어지는 커브 작은 표지판, 글자(조여짐·이어서)는 없다', () => {
    const { container } = render(<PaceNoteTile up={{ note: note({ mod: '조여짐' }), distM: 30, then: note({ dir: 'right', grade: 4 }) }} />);
    const tile = container.querySelector('.pace-tile')!;
    expect(tile).toHaveTextContent('30m');
    expect(tile).not.toHaveTextContent('조여짐');
    expect(tile).not.toHaveTextContent('이어서');
    expect(screen.getByRole('img', { name: '왼쪽 3 조여짐' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '오른쪽 4' })).toBeInTheDocument();
  });

  it('다음 커브가 없으면 회색 직진 표지판', () => {
    const { container } = render(<PaceNoteTile up={null} />);
    expect(container.querySelector('.pace-tile')).not.toBeNull();
    expect(screen.getByRole('img', { name: '앞에 커브 없음' })).toBeInTheDocument();
  });
});
