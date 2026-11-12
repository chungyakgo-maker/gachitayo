// 주행 후 처리를 화면과 다른 스레드에서 돌린다 (긴 세션은 폰에서 몇 초 걸린다).
import { processDrive, type DriveInput } from '../engine/process/processDrive';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DriveInput>) => void) | null;
  postMessage: (m: unknown) => void;
};

ctx.onmessage = (e) => {
  try {
    ctx.postMessage({ ok: true, result: processDrive(e.data) });
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
