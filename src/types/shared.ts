// 모두의 코스 서버 자료 꼴 (worker/src/shared.ts 와 같은 이름) — 설계 2부
import type { Gate } from './course';

export type LatLonPair = [number, number];

/** 공개·고치기 때 보내는 몸 */
export interface SharedBody {
  name: string;
  region: string;
  kind: 'loop' | 'point_to_point';
  lengthM: number;
  startGate: Gate;
  finishGate: Gate;
  sectorBoundsM: [number, number] | null;
  /** 2 m 오차 안으로 줄인 선 */
  line: LatLonPair[];
  /** 목록 작은 그림용 (40점 이하) */
  thumb: LatLonPair[];
}

/** 목록 한 줄 */
export interface SharedSummary {
  id: string;
  name: string;
  region: string;
  kind: 'loop' | 'point_to_point';
  lengthM: number;
  start: { lat: number; lon: number };
  thumb: LatLonPair[];
  adds: number;
  /** 올린 사람 닉네임 */
  by: string;
  /** 올린 사람 계정 번호 (이 사람 코스 안 보기) */
  byId: string;
  createdAt: number;
  mine: boolean;
}

/** 상세 (선 포함) */
export interface SharedDetail extends SharedSummary {
  line: LatLonPair[];
  startGate: Gate;
  finishGate: Gate;
  sectorBoundsM: [number, number] | null;
  status: 'open' | 'hidden';
}
