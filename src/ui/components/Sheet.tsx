import type { ReactNode } from 'react';
import { Overlay } from './Overlay';

/** 아래에서 올라오는 고르기 창 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Overlay>
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <h2>{title}</h2>
          {children}
          <button type="button" className="ghost-btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </Overlay>
  );
}
