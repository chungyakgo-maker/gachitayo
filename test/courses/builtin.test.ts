import { describe, expect, it } from 'vitest';
import { BUILTIN_COURSES, builtinCourse, builtinInfo, missingBuiltins, renamedBuiltins, sortCourses } from '../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../src/courses/builtinData';
import type { Course } from '../../src/types/course';

const built = BUILTIN_COURSES.map((b) => builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: crypto.randomUUID(), gateWidthM: 30 }));

describe('기본 코스 (사양서 7.5)', () => {
  it('사용자가 준 카카오맵 GPX 열여섯 개, 모두 편도', () => {
    expect(BUILTIN_COURSES.map((b) => b.name)).toEqual([
      '배후령',
      '미시령 옛길',
      '만항재',
      '말티재',
      '구룡령',
      '로코갤러리',
      '하오고개',
      '북악스카이웨이',
      '남한산성',
      '진부면',
      '평화의댐',
      '군위 남산리–칠곡 기성리',
      '칠곡 연호리–덕산리',
      '함백역–문곡리',
      '매봉산 바람의언덕',
      '적상산전망대',
    ]);
    for (const b of BUILTIN_COURSES) expect(BUILTIN_POINTS[b.key]!.length).toBeGreaterThan(200);
    expect(new Set(BUILTIN_COURSES.map((b) => b.key)).size).toBe(BUILTIN_COURSES.length);
    expect(new Set(built.map((c) => c.kind))).toEqual(new Set(['point_to_point']));
    expect(new Set(built.map((c) => c.source))).toEqual(new Set(['gpx']));
    expect(built.map((c) => c.builtin)).toEqual(BUILTIN_COURSES.map((b) => b.key));
  });

  it('길이는 카카오맵 경로 길이와 같다 (±3%)', () => {
    const km = built.map((c) => c.lengthM! / 1000);
    [8.48, 10.09, 10.69, 2.1, 16.97, 6.48, 3.29, 7.19, 3.86, 25.06, 49.86, 7.73, 4.81, 6.7, 3.57, 7.53].forEach((want, i) => expect(Math.abs(km[i]! - want) / want).toBeLessThan(0.03));
  });

  it('기본 이름이 바뀌면(가평 복장리–상천리 → 로코갤러리) 폰에 예전 이름으로 있는 것만 바꾼다. 직접 바꾼 이름은 그대로', () => {
    const gp = built[5]!;
    expect(gp.name).toBe('로코갤러리');
    expect(renamedBuiltins([{ ...gp, name: '가평 복장리–상천리' }]).map((c) => c.name)).toEqual(['로코갤러리']);
    expect(renamedBuiltins([gp])).toEqual([]);
    expect(renamedBuiltins([{ ...gp, name: '내가 지은 이름' }])).toEqual([]);
    expect(renamedBuiltins([{ ...built[0]!, builtin: undefined, name: '가평 복장리–상천리' }])).toEqual([]);
  });

  it('출발선은 출발점, 도착선은 도착점 근처. 선 폭은 설정값', () => {
    const near = (a: { lat: number; lon: number }, lat: number, lon: number) => Math.hypot((a.lat - lat) * 111_000, (a.lon - lon) * 88_000);
    const [bh, ms, mh, mt, gr] = built;
    expect(near(bh!.startGate, 37.957817, 127.779633)).toBeLessThan(30);
    expect(near(ms!.startGate, 38.219723, 128.40716)).toBeLessThan(60);
    expect(near(mh!.finishGate, 37.148539, 128.898966)).toBeLessThan(80);
    expect(near(mt!.finishGate, 36.49907, 127.789325)).toBeLessThan(30);
    // 16.4 km가 넘는 편도: 도착선이 출발점으로 끌려가지 않는다 (평활 버그 수정)
    expect(near(gr!.finishGate, 37.906731, 128.506899)).toBeLessThan(30);
    // 사용자가 준 카카오맵 GPX (2026-11-13): 진부면 = 평창 진부 → 정선 숙암, 평화의댐 = 화천 → 양구
    const jb = built.find((c) => c.builtin === 'jinbu-myeon');
    const pd = built.find((c) => c.builtin === 'pyeonghwa-dam');
    expect(near(jb!.startGate, 37.632411, 128.55414)).toBeLessThan(40);
    expect(near(jb!.finishGate, 37.476211, 128.613823)).toBeLessThan(40);
    expect(near(pd!.startGate, 38.127392, 127.748373)).toBeLessThan(40);
    expect(near(pd!.finishGate, 38.159154, 127.964281)).toBeLessThan(40);
    expect(BUILTIN_COURSES.filter((b) => b.key === 'jinbu-myeon' || b.key === 'pyeonghwa-dam').map((b) => b.route)).toEqual(['진부 → 숙암', '화천 → 양구']);
    // 사용자가 준 카카오맵 GPX 다섯 개 (2026-11-13 두 번째): 이름은 GPX에 적힌 곳 이름(사용자 확인 전)
    const gate = (key: string) => built.find((c) => c.builtin === key)!;
    const ends: Array<[string, number, number, number, number]> = [
      ['gunwi-namsan-chilgok-giseong', 36.030296, 128.628896, 36.014036, 128.598824],
      ['chilgok-yeonho-deoksan', 35.92799, 128.520143, 35.944825, 128.495544],
      ['hambaek-mungok', 37.216038, 128.697361, 37.228641, 128.727823],
      ['maebongsan-baramui-eondeok', 37.221027, 128.986616, 37.215112, 128.964432],
      ['jeoksangsan-observatory', 35.975982, 127.692123, 35.95637, 127.698461],
    ];
    for (const [key, sLat, sLon, fLat, fLon] of ends) {
      expect(near(gate(key).startGate, sLat, sLon)).toBeLessThan(60);
      expect(near(gate(key).finishGate, fLat, fLon)).toBeLessThan(60);
    }
    expect(ends.map(([key]) => BUILTIN_COURSES.find((b) => b.key === key)!.route)).toEqual([
      '군위 부계면 → 칠곡 동명면',
      '칠곡 지천면 연호리 → 덕산리',
      '함백역 → 정선 남면 문곡리',
      '태백 적각동 → 매봉산 바람의언덕',
      '무주 적상면 북창리 → 적상산전망대',
    ]);
    for (const c of built) expect([c.startGate.widthM, c.finishGate.widthM]).toEqual([30, 30]);
  });

  it('목록에 없는 기본 코스만 넣고, 내 코스 다음에 정한 순서로 보인다', () => {
    const mine = { ...built[0]!, id: 'mine', builtin: undefined, name: '내 코스' } as Course;
    expect(missingBuiltins([mine]).map((b) => b.key)).toEqual(BUILTIN_COURSES.map((b) => b.key));
    // 나중에 추가된 기본 코스만 더 넣는다
    expect(missingBuiltins([mine, ...built.slice(0, 5)]).map((b) => b.key)).toEqual(BUILTIN_COURSES.slice(5).map((b) => b.key));
    expect(missingBuiltins([mine, ...built.slice(0, 11)]).map((b) => b.key)).toEqual(['gunwi-namsan-chilgok-giseong', 'chilgok-yeonho-deoksan', 'hambaek-mungok', 'maebongsan-baramui-eondeok', 'jeoksangsan-observatory']);
    const sorted = sortCourses([built[2]!, built[4]!, built[0]!, mine, built[1]!, built[3]!]);
    expect(sorted.map((c) => c.name)).toEqual(['내 코스', '배후령', '미시령 옛길', '만항재', '말티재', '구룡령']);
    expect(builtinInfo(built[1]!)?.route).toBe('인제 → 고성');
    expect(builtinInfo(mine)).toBeNull();
  });
});
