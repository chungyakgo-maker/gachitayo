// 주행 후 처리 실행: 브라우저에서는 Web Worker, 테스트(jsdom)처럼 Worker가 없으면 바로 실행한다.
import { processDrive, type DriveInput, type DriveResult } from '../engine/process/processDrive';

export function runProcessDrive(input: DriveInput): Promise<DriveResult> {
  if (typeof Worker === 'undefined') {
    try {
      return Promise.resolve(processDrive(input));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./processWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ ok: true; result: DriveResult } | { ok: false; error: string }>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || '처리 중 오류'));
    };
    w.postMessage(input);
  });
}
