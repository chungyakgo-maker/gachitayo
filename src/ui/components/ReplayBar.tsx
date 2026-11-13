// 재생 막대 (사양서 10.2, 사용자 요청 "재생 막대를 끌어서 옮기기"): 멈춤/재생 · 지금 시간 · 막대 · 전체 시간 · 배속.
// 막대는 브라우저의 range 입력이라 손가락으로 끌기·키보드 모두 된다. 끄는 동안 onSeek가 계속 불린다.
import type { CSSProperties } from 'react';

export interface ReplayBarProps {
  posMs: number;
  endMs: number;
  playing: boolean;
  speed: number;
  onPlayPause(): void;
  onSeek(ms: number): void;
  onSpeed(): void;
}

/** 시간 글자: m:ss, 한 시간 넘으면 h:mm:ss */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function ReplayBar({ posMs, endMs, playing, speed, onPlayPause, onSeek, onSpeed }: ReplayBarProps) {
  const pct = endMs > 0 ? Math.min(100, Math.max(0, (posMs / endMs) * 100)) : 0;
  return (
    <div className="replay-bar" role="group" aria-label="재생 막대">
      <button type="button" className="pp" aria-label={playing ? '멈춤' : '재생'} onClick={onPlayPause}>
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="3" y="2" width="4" height="14" rx="1" fill="currentColor" />
            <rect x="11" y="2" width="4" height="14" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M5 2l11 7-11 7z" fill="currentColor" />
          </svg>
        )}
      </button>
      <span className="t">{formatClock(posMs)}</span>
      <input
        type="range"
        aria-label="재생 위치"
        min={0}
        max={endMs}
        step={100}
        value={posMs}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span className="t">{formatClock(endMs)}</span>
      <button type="button" className="spd" aria-label={`재생 속도 ${speed}배, 누르면 바꾸기`} onClick={onSpeed}>
        {speed}×
      </button>
    </div>
  );
}
