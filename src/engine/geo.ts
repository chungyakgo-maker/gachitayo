// 지역 좌표 (사양서 7.1): 코스 원점 기준 평면(m). x 동쪽, y 북쪽.
// 수 km 규모라 등장방형 근사로 충분하다.

export interface LatLon {
  lat: number;
  lon: number;
}

/** 지구 평균 반지름 m */
const EARTH_R = 6_371_008.8;
const RAD = Math.PI / 180;

export function toLocal(origin: LatLon, lat: number, lon: number): { x: number; y: number } {
  return {
    x: (lon - origin.lon) * RAD * EARTH_R * Math.cos(origin.lat * RAD),
    y: (lat - origin.lat) * RAD * EARTH_R,
  };
}

export function fromLocal(origin: LatLon, x: number, y: number): LatLon {
  return {
    lat: origin.lat + y / (EARTH_R * RAD),
    lon: origin.lon + x / (EARTH_R * RAD * Math.cos(origin.lat * RAD)),
  };
}
