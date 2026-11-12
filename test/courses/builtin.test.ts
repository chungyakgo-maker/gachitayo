import { describe, expect, it } from 'vitest';
import { BUILTIN_COURSES, builtinCourse, builtinInfo, missingBuiltins, sortCourses } from '../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../src/courses/builtinData';
import type { Course } from '../../src/types/course';

const built = BUILTIN_COURSES.map((b) => builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: crypto.randomUUID(), gateWidthM: 30 }));

describe('기본 코스 (사양서 7.5)', () => {
  it('사용자가 준 카카오맵 GPX 세 개: 배후령 · 미시령 옛길 · 만항재, 모두 편도', () => {
    expect(BUILTIN_COURSES.map((b) => b.name)).toEqual(['배후령', '미시령 옛길', '만항재']);
    for (const b of BUILTIN_COURSES) expect(BUILTIN_POINTS[b.key]!.length).toBeGreaterThan(600);
    expect(built.map((c) => c.kind)).toEqual(['point_to_point', 'point_to_point', 'point_to_point']);
    expect(built.map((c) => c.source)).toEqual(['gpx', 'gpx', 'gpx']);
    expect(built.map((c) => c.builtin)).toEqual(['baehuryeong', 'misiryeong-old', 'manhangjae']);
  });

  it('길이는 카카오맵 경로 길이와 같다 (8.48 · 10.09 · 10.69 km, ±3%)', () => {
    const km = built.map((c) => c.lengthM! / 1000);
    [8.48, 10.09, 10.69].forEach((want, i) => expect(Math.abs(km[i]! - want) / want).toBeLessThan(0.03));
  });

  it('출발선은 출발점, 도착선은 도착점 근처. 선 폭은 설정값', () => {
    const near = (a: { lat: number; lon: number }, lat: number, lon: number) => Math.hypot((a.lat - lat) * 111_000, (a.lon - lon) * 88_000);
    const [bh, ms, mh] = built;
    expect(near(bh!.startGate, 37.957817, 127.779633)).toBeLessThan(30);
    expect(near(ms!.startGate, 38.219723, 128.40716)).toBeLessThan(60);
    expect(near(mh!.finishGate, 37.148539, 128.898966)).toBeLessThan(80);
    for (const c of built) expect([c.startGate.widthM, c.finishGate.widthM]).toEqual([30, 30]);
  });

  it('목록에 없는 기본 코스만 넣고, 내 코스 다음에 정한 순서로 보인다', () => {
    const mine = { ...built[0]!, id: 'mine', builtin: undefined, name: '내 코스' } as Course;
    expect(missingBuiltins([mine]).map((b) => b.key)).toEqual(['baehuryeong', 'misiryeong-old', 'manhangjae']);
    expect(missingBuiltins([mine, built[1]!]).map((b) => b.key)).toEqual(['baehuryeong', 'manhangjae']);
    const sorted = sortCourses([built[2]!, built[0]!, mine, built[1]!]);
    expect(sorted.map((c) => c.name)).toEqual(['내 코스', '배후령', '미시령 옛길', '만항재']);
    expect(builtinInfo(built[1]!)?.route).toBe('인제 → 고성');
    expect(builtinInfo(mine)).toBeNull();
  });
});
