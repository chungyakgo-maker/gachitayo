// 처음 한 번 옮기는 중 (기록은 폰에만 3단계, 예전 되살리기 5.7): 기록 탭 맨 위와 설정 계정 칸에 진행 상황
import { useRestore, type RestoreState } from '../../app/restore';

export function restoreProgressText(s: RestoreState): string | null {
  const fail = s.failed > 0 ? `실패 ${s.failed} (다음에 다시)` : '';
  if (s.running && s.total > 0) return `예전 기록을 이 폰으로 옮기는 중 ${s.done}/${s.total}${fail ? ` · ${fail}` : ''}`;
  if (!s.running && s.failed > 0) return `예전 기록 옮기기: ${fail}`;
  return null;
}

export function RestoreBanner() {
  const text = restoreProgressText(useRestore());
  if (!text) return null;
  return (
    <div className="notice" role="status">
      {text}
    </div>
  );
}
