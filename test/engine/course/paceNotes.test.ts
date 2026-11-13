import { describe, expect, it } from 'vitest';
import { makePolyline, type Polyline } from '../../../src/engine/course/polyline';
import { paceNotes, upcomingNote, type PaceNote } from '../../../src/engine/course/paceNotes';
import { BUILTIN_COURSES, builtinCourse } from '../../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../../src/courses/builtinData';
import { buildGeometry } from '../../../src/engine/course/geometry';

type Seg = ['line', number] | ['arc', number, number, 1 | -1];

/** 동쪽으로 출발해 구간을 따라 1 m마다 점을 찍은 코스 선 (arc: 각도°, 반지름, +1 왼쪽 / −1 오른쪽) */
function trace(segs: Seg[], noise = 0): Polyline {
  let x = 0;
  let y = 0;
  let psi = 0;
  const xs = [x];
  const ys = [y];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (const g of segs) {
    if (g[0] === 'line') {
      for (let d = 1; d <= g[1]; d++) {
        x += Math.cos(psi);
        y += Math.sin(psi);
        xs.push(x + rnd() * noise * -Math.sin(psi));
        ys.push(y + rnd() * noise * Math.cos(psi));
      }
    } else {
      const [, deg, r, side] = g;
      const len = (deg * Math.PI * r) / 180;
      const n = Math.max(1, Math.round(len));
      for (let k = 0; k < n; k++) {
        psi += (side * (deg * Math.PI)) / 180 / n;
        x += Math.cos(psi) * (len / n);
        y += Math.sin(psi) * (len / n);
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return makePolyline(xs, ys);
}

describe('커브 찾기·등급 (사양서 8.4 커브 표지판)', () => {
  it('왼쪽 반지름 35 m 90° 커브 → 왼쪽 3, 회전 약 90°, 직선 끝 근처에서 시작', () => {
    const notes = paceNotes(trace([['line', 200], ['arc', 90, 35, 1], ['line', 200]]));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ dir: 'left', grade: 3, mod: null });
    expect(Math.abs(notes[0]!.angleDeg - 90)).toBeLessThan(12);
    expect(Math.abs(notes[0]!.s0 - 200)).toBeLessThan(20);
  });

  it('오른쪽 반지름 80 m 60° → 오른쪽 5', () => {
    const notes = paceNotes(trace([['line', 200], ['arc', 60, 80, -1], ['line', 200]]));
    expect(notes.map((n) => [n.dir, n.grade])).toEqual([['right', 5]]);
  });

  it('반지름 12 m 180° → 헤어핀, 꼭짓점에서 90° 꺾임 → 스퀘어', () => {
    expect(paceNotes(trace([['line', 200], ['arc', 180, 12, 1], ['line', 200]])).map((n) => n.grade)).toEqual(['H']);
    expect(paceNotes(trace([['line', 200], ['arc', 90, 0.5, -1], ['line', 200]])).map((n) => [n.dir, n.grade])).toEqual([['right', 'S']]);
  });

  it('갈수록 급해지면 조여짐, 갈수록 완만해지면 풀림, 크게 오래 돌면 길게', () => {
    const tight = paceNotes(trace([['line', 200], ['arc', 40, 60, 1], ['arc', 50, 25, 1], ['line', 200]]));
    expect(tight.map((n) => [n.dir, n.mod])).toEqual([['left', '조여짐']]);
    const open = paceNotes(trace([['line', 200], ['arc', 50, 25, -1], ['arc', 40, 60, -1], ['line', 200]]));
    expect(open.map((n) => [n.dir, n.mod])).toEqual([['right', '풀림']]);
    const long = paceNotes(trace([['line', 200], ['arc', 120, 70, 1], ['line', 200]]));
    expect(long.map((n) => [n.grade, n.mod])).toEqual([[5, '길게']]);
  });

  it('곧은 길의 작은 흔들림(±0.3 m)에는 커브가 없다', () => {
    expect(paceNotes(trace([['line', 800]], 0.3))).toEqual([]);
  });

  it('기본 코스 11개: 꺾은선 꼭짓점마다 가짜 커브가 생기지 않는다 (1 km당 1~15개), 말티재는 헤어핀이 5개 넘는다', () => {
    const perKm: Record<string, number> = {};
    for (const b of BUILTIN_COURSES) {
      const g = buildGeometry(builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: b.key, gateWidthM: 30 }));
      const notes = paceNotes(g.centerline!);
      perKm[b.name] = notes.length / (g.centerline!.length / 1000);
      if (b.key === 'maltijae') expect(notes.filter((n) => n.grade === 'H').length).toBeGreaterThan(5);
      expect(notes.every((n, i) => i === 0 || n.s0 >= notes[i - 1]!.s0)).toBe(true);
    }
    for (const [name, v] of Object.entries(perKm)) expect([name, v >= 1 && v <= 15]).toEqual([name, true]);
  });
});

describe('다음 커브 고르기 (사양서 8.4)', () => {
  const note = (s0: number, s1: number, grade: PaceNote['grade'] = 3): PaceNote => ({ s0, s1, dir: 'left', grade, mod: null, angleDeg: 60, radiusM: 40 });
  const notes = [note(100, 140), note(160, 200, 4), note(600, 650, 2)];

  it('앞에서 시작하는 첫 커브와 남은 거리(10 m 단위), 끝에서 30 m 안에 다음 커브가 시작하면 이어서', () => {
    const up = upcomingNote(notes, 47, { lengthM: 1000, loop: false })!;
    expect(up.note.s0).toBe(100);
    expect(up.distM).toBe(50);
    expect(up.then?.s0).toBe(160);
    expect(upcomingNote(notes, 96, { lengthM: 1000, loop: false })!.distM).toBe(10);
  });

  it('커브에 들어서면 다음 커브로 바뀌고, 250 m 넘게 남으면 보이지 않는다', () => {
    const up = upcomingNote(notes, 120, { lengthM: 1000, loop: false })!;
    expect(up.note.s0).toBe(160);
    expect(up.then).toBeNull();
    expect(upcomingNote(notes, 300, { lengthM: 1000, loop: false })).toBeNull();
    expect(upcomingNote(notes, 700, { lengthM: 1000, loop: false })).toBeNull();
  });

  it('랩 코스는 끝을 지나 처음 커브로 이어진다', () => {
    const up = upcomingNote(notes, 980, { lengthM: 1000, loop: true })!;
    expect(up.note.s0).toBe(100);
    expect(up.distM).toBe(120);
    expect(upcomingNote([], 10, { lengthM: 1000, loop: true })).toBeNull();
  });
});
