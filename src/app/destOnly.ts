// 목적지만 담은 경로 (정식 빌드 팀 주행, 검토 지적 2026-11-18): 방장의 경로는 방장 위치에서 시작해서, 그대로 보내면 팀원들이
// 방장이 지금 어디 있는지 알게 된다. 위치 공유를 끈 빌드는 목적지만 보내고, 받은 사람은 자기 위치에서 길을 찾는다.
// 서버는 점 2개 이상을 요구하므로 목적지와 그 바로 옆(약 1 m) 두 점, 거리·시간 0 으로 표시한다
import type { RouteData } from './routeNav';

export function destOnlyRoute(dest: { lat: number; lon: number }): RouteData {
  return { distanceM: 0, durationS: 0, points: [[dest.lat, dest.lon], [dest.lat + 0.00001, dest.lon]], destName: null };
}

export const isDestOnly = (r: Pick<RouteData, 'distanceM' | 'durationS'>): boolean => r.distanceM === 0 && r.durationS === 0;
