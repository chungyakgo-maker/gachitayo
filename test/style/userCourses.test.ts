// courses/ 폴더 → 기본 코스 (2026-11-27 세영 "내가 직접 올리려면" → "1번 ㄱ"): GPX + 정보.txt 를 읽어 기본 코스 파일을 만들고,
// 틀린 파일이면 무엇이 틀렸는지 한국어로 알리고 멈춘다 (배포가 되지 않게)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '../../scripts/builtin-courses.mjs');
const gpx = (tracks: Array<[string, Array<[number, number]>]>) =>
  `<?xml version="1.0"?><gpx version="1.1">${tracks.map(([n, pts]) => `<trk><name>${n}</name><trkseg>${pts.map(([a, o]) => `<trkpt lon="${o}" lat="${a}"><ele>1</ele></trkpt>`).join('')}</trkseg></trk>`).join('')}</gpx>`;
const loop = Array.from({ length: 30 }, (_, k): [number, number] => [37.5 + 0.003 * Math.sin((k / 29) * 2 * Math.PI), 127 + 0.004 * Math.cos((k / 29) * 2 * Math.PI)]);

function run(files: Record<string, string>): { ok: boolean; out: string; meta?: string; points?: string } {
  const dir = mkdtempSync(join(tmpdir(), 'courses-'));
  const out = mkdtempSync(join(tmpdir(), 'gen-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  try {
    const o = execFileSync('node', [SCRIPT], { env: { ...process.env, COURSES_DIR: dir, COURSES_OUT: out }, encoding: 'utf8' });
    return { ok: true, out: o, meta: readFileSync(join(out, 'builtinUser.gen.ts'), 'utf8'), points: readFileSync(join(out, 'builtinUserPoints.gen.ts'), 'utf8') };
  } catch (e) {
    return { ok: false, out: String((e as { stdout?: string }).stdout) };
  }
}

describe('courses/ 폴더 → 기본 코스', () => {
  it('정보.txt 의 이름·지역·분류·설명·고침 + GPX 트랙(여러 개면 고른 것) → 목록 한 줄과 점 (소수 6자리). _ 폴더는 건너뛴다', () => {
    const r = run({
      '영암 새 코스/정보.txt': '# 메모\n이름: 새 서킷\n지역: 전남 영암 · 서킷 한 바퀴\n분류: 서킷\n설명: 첫 줄\n설명: 둘째 줄\n고침: 2\n트랙: 고른 트랙\n',
      '영암 새 코스/아무이름.GPX': gpx([['다른 트랙', loop.slice(0, 12)], ['고른 트랙', loop]]),
      '_예시/정보.txt': '이름: 예시\n',
    });
    expect(r.ok).toBe(true);
    expect(r.out).toContain('기본 코스(courses/) 1개: 새 서킷');
    const list = JSON.parse(/= (\[[\s\S]*\]);/.exec(r.meta!)![1]!) as Array<Record<string, unknown>>;
    expect(list).toEqual([{ key: expect.stringMatching(/^c-[0-9a-f]{10}$/), name: '새 서킷', route: '전남 영암 · 서킷 한 바퀴', desc: ['첫 줄', '둘째 줄'], tags: ['circuit'], rev: 2 }]);
    const nums = /\[([-\d.,]+)\]/.exec(r.points!)![1]!.split(',').map(Number);
    expect(nums.length).toBe(loop.length * 2);
    expect(nums[0]).toBeCloseTo(loop[0]![0], 6);
    expect(nums[1]).toBeCloseTo(loop[0]![1], 6);
  });

  it('폴더가 없거나 비면 0개 (빈 목록)', () => {
    const r = run({});
    expect(r.ok).toBe(true);
    expect(r.meta).toContain('USER_BUILTINS: readonly BuiltinCourse[] = []');
  });

  it('틀린 파일은 무엇이 틀렸는지 알리고 멈춘다', () => {
    const r = run({
      'a/정보.txt': '이름: A\n',
      'a/a.gpx': gpx([['t', loop]]),
      'b/정보.txt': '이름: B\n지역: 어딘가\n분류: 고속도로\n',
      'b/b.gpx': gpx([['t1', loop], ['t2', loop]]),
      'c/c.gpx': gpx([['t', loop]]),
    });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('courses/a: 정보.txt 에 "지역: …" 줄이 없어요');
    expect(r.out).toContain('courses/b: 분류 "고속도로"');
    expect(r.out).toContain('courses/b: GPX 에 트랙이 2개예요');
    expect(r.out).toContain('courses/c: 정보.txt 가 없어요');
  });
});
