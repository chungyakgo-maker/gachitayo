// 주행 준비 › 기울기 0점 (2026-11-19 세영 "0에서도 기울기 동작하게끔해", 웹 빌드에서만 — 스냅숏에 기울기 칸이 있을 때)
// 기울기는 "똑바로 선 자세(0점)"에서 기운 각도라, 바이크를 똑바로 세우고 0점을 맞추면 가장 정확하다 (leanFusion.ts)
import { useState } from 'react';
import { useLiveSnapshot, zeroLean } from '../../app/drive';
import { leanFused } from '../../features';
import type { LeanRef } from '../../engine/derive/leanFusion';

export function formatLean(deg: number): string {
  const d = Math.round(Math.abs(deg));
  if (d === 0) return '0°';
  return `${deg > 0 ? '오른쪽' : '왼쪽'} ${d}°`;
}

export const LEAN_REF_TEXT: Record<LeanRef, string> = {
  user: '직접 맞춘 0점이에요',
  auto: '달리며 자동으로 맞춘 0점이에요 (곧게 달린 자세)',
  still: '정차 자세 기준이에요. 바이크를 똑바로 세우고 0점을 맞추면 더 정확해요',
  none: '아직 0점이 없어요. 바이크를 똑바로 세우고 0점을 맞춰 주세요',
};

export const LEAN_WAIT_TEXT = '센서 값을 기다리는 중이에요. 주행 시작에서 동작 센서를 허락했는지 확인해 주세요';

export const ZERO_FAIL_TEXT = '센서 값이 아직 없어요. 주행 시작에서 동작 센서를 허락했는지 보고 잠시 뒤 다시 눌러 주세요';

export function LeanZeroCard() {
  const snap = useLiveSnapshot();
  const [note, setNote] = useState<string | null>(null);
  const lean = snap?.lean ?? null;
  // 앱 빌드(예전 계산)에는 0점이 없다
  if (!leanFused()) return null;
  const zero = () => setNote(zeroLean() ? '0점을 맞췄어요' : ZERO_FAIL_TEXT);
  return (
    <section aria-label="기울기 0점" className="card card-col" style={{ gap: 8 }}>
      <span className="label">기울기 0점</span>
      {lean ? (
        <>
          <strong style={{ fontSize: 17 }}>지금 {formatLean(lean.deg)}</strong>
          <span className="sub">{LEAN_REF_TEXT[lean.ref]}</span>
        </>
      ) : (
        <span className="sub">{LEAN_WAIT_TEXT}</span>
      )}
      {note && (
        <span className="sub" role="status">
          {note}
        </span>
      )}
      <div className="card-row" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn small" onClick={zero}>
          0점 맞추기
        </button>
        <a className="link-btn" href="#/dev/lean">
          기울기 시험 보기 ›
        </a>
      </div>
    </section>
  );
}
