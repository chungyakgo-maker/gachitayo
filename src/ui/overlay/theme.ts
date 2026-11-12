// 오버레이 색·글꼴 (styles.css의 시안 값과 같다). 캔버스는 CSS 변수를 읽지 못해 여기에 값을 둔다.
import type { DeltaPalette } from '../../app/settings';

export interface OverlayTheme {
  fast: string;
  slow: string;
  fastBg: string;
  slowBg: string;
  fastLine: string;
  slowLine: string;
  fg: string;
  fg2: string;
  fgDim: string;
  fgOff: string;
  tile: string;
  tileLine: string;
  cardLine: string;
  accent: string;
  sans: string;
  mono: string;
}

const BASE = {
  fg: '#eceef0',
  fg2: '#c9cdd2',
  fgDim: '#9aa1a9',
  fgOff: '#5e656d',
  tile: '#101114',
  tileLine: '#22262b',
  cardLine: '#2a2e33',
  accent: '#ffb224',
  sans: "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
};

const PALETTE: Record<DeltaPalette, Pick<OverlayTheme, 'fast' | 'slow' | 'fastBg' | 'slowBg' | 'fastLine' | 'slowLine'>> = {
  'green-red': {
    fast: '#3ee08f',
    slow: '#ff5b4f',
    fastBg: 'rgba(62, 224, 143, 0.12)',
    slowBg: 'rgba(255, 91, 79, 0.13)',
    fastLine: 'rgba(62, 224, 143, 0.35)',
    slowLine: 'rgba(255, 91, 79, 0.4)',
  },
  'blue-orange': {
    fast: '#5cb8ff',
    slow: '#e8690f',
    fastBg: 'rgba(92, 184, 255, 0.12)',
    slowBg: 'rgba(232, 105, 15, 0.15)',
    fastLine: 'rgba(92, 184, 255, 0.35)',
    slowLine: 'rgba(232, 105, 15, 0.45)',
  },
};

export function overlayTheme(palette: DeltaPalette = 'green-red'): OverlayTheme {
  return { ...BASE, ...PALETTE[palette] };
}
