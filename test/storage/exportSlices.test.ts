// 아이폰 앱 파일 저장 (기록은 폰에만 검토 지적 1): 백업 파일은 100 MB 넘을 수 있어 base64 한 덩어리로 넘기면 앱이 멈춘다 → 조각으로 나눠 쓴다
import { describe, expect, it } from 'vitest';
import { writeInSlices } from '../../src/storage/exportFile';

describe('writeInSlices', () => {
  it('첫 조각은 새로 쓰고 나머지는 이어 쓴다. 이어 붙이면 원래 바이트와 같다', async () => {
    const bytes = new Uint8Array(7 * 1000 + 5).map((_, i) => (i * 31) % 256);
    const calls: Array<{ op: string; data: string }> = [];
    const uri = await writeInSlices(new Blob([bytes]), {
      write: async (data) => (calls.push({ op: 'write', data }), { uri: 'file:///x.dgo' }),
      append: async (data) => void calls.push({ op: 'append', data }),
    }, 3000);
    expect(uri).toBe('file:///x.dgo');
    expect(calls.map((c) => c.op)).toEqual(['write', 'append', 'append']);
    const back = calls.flatMap((c) => [...Uint8Array.from(atob(c.data), (ch) => ch.charCodeAt(0))]);
    expect(back).toEqual([...bytes]);
  });

  it('빈 파일도 한 번은 쓴다', async () => {
    const ops: string[] = [];
    await writeInSlices(new Blob([]), { write: async () => (ops.push('write'), { uri: 'u' }), append: async () => void ops.push('append') }, 3000);
    expect(ops).toEqual(['write']);
  });
});
