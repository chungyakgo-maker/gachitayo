import { useEffect, useState } from 'react';
import { getDriveRepo } from '../../app/recording';
import type { Course } from '../../types/course';

/** 코스별 내 베스트 랩타임 (같은 버전의 비교 랩 중 가장 빠른 것) */
export function useBestTimes(courses: Course[]): Record<string, number | null> {
  const [best, setBest] = useState<Record<string, number | null>>({});
  const key = courses.map((c) => `${c.id}@${c.version}`).join(',');
  useEffect(() => {
    let alive = true;
    void Promise.all(
      courses.map(async (c) => [c.id, (await getDriveRepo().bestRefLap(c.id, c.version))?.lapTimeMs ?? null] as const),
    ).then((pairs) => {
      if (alive) setBest(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return best;
}
