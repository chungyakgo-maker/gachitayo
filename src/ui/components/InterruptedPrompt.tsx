import { formatKst } from '../format';
import { Overlay } from './Overlay';

interface InterruptedPromptProps {
  /** epoch ms */
  startedAt: number;
  onResume: () => void;
  onFinish: () => void;
}

/** 사양서 9장: 다시 열면 "중단된 주행 이어서 하기 / 끝내기"를 묻는다. */
export function InterruptedPrompt({ startedAt, onResume, onFinish }: InterruptedPromptProps) {
  return (
    <Overlay>
      <div className="modal-backdrop">
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="interrupted-title">
          <h2 id="interrupted-title">중단된 기록이 있습니다</h2>
          <p>{formatKst(startedAt)}에 시작한 기록이 끝나지 않았습니다.</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={onResume}>
              이어서 하기
            </button>
            <button type="button" className="btn" onClick={onFinish}>
              끝내기
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
