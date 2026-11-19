// 팀 방 코스 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md 3부, 시안 ⑨⑩):
// 방장 폰의 코스를 방에 보낼 모양으로 줄이고, 팀원 폰에서는 받은 모양을 이미 있는 코스에 잇거나 새 코스로 담는다.
// 방장 위치는 보내지 않는다 — 코스 모양(출발선·도착선·줄인 선)만 보내고, 출발점까지 길은 각자 찾는다
import { sameCourseShape } from '../engine/course/edit';
import { expandLine, fitLine } from '../engine/course/share';
import type { Course, Gate } from '../types/course';
import { loadCourses } from './drive';
import { getDriveRepo } from './recording';
import { assertCourseRoom } from './storageLimits';

/** 방 상태에 실리는 코스 요약 (서버 worker/src/group.ts 와 같은 칸) */
export interface RoomCourseMeta {
  name: string;
  kind: Course['kind'];
  lengthM: number;
  /** 기본 코스 b:{key} · 모두의 코스 s:{공개 번호} · 그 밖엔 null — 팀원 폰에서 같은 코스를 찾는 열쇠 */
  key: string | null;
}
/** 코스 모양 (POST·GET /api/rooms/{id}/course) */
export interface RoomCourse extends RoomCourseMeta {
  startGate: Gate;
  finishGate: Gate;
  sectorBoundsM: [number, number] | null;
  /** 줄인 선 (지도로 만들어 아직 선이 없으면 빈 배열) */
  line: Array<[number, number]>;
}

/** 서버가 받는 한도 */
const ROOM_LINE_MAX = 3000;
const ROOM_LENGTH_MAX = 100_000;

const gate = (g: Gate): Gate => ({ lat: g.lat, lon: g.lon, bearingDeg: g.bearingDeg, widthM: g.widthM });

/** 열쇠: 기본 코스·받은 공개 코스·내가 공개한 코스면 팀원도 같은 코스를 바로 찾는다 */
function keyOf(c: Course): string | null {
  if (c.builtin) return `b:${c.builtin}`;
  if (c.shared) return `s:${c.shared.id}`;
  if (c.publishedId) return `s:${c.publishedId}`;
  return null;
}

/** 방장: 방에 보낼 코스 모양 */
export function roomCourseBody(c: Course): RoomCourse {
  const lengthM = Math.round(c.lengthM ?? 0);
  // 서버가 100 km 까지 받는다 — 보내 보고 알 수 없는 오류가 나기 전에 알린다
  if (lengthM > ROOM_LENGTH_MAX) throw new Error('100 km 넘는 코스는 팀 방에 정할 수 없어요');
  const line = c.centerline && c.centerline.length >= 2 ? fitLine(c.centerline, ROOM_LINE_MAX) : [];
  return { name: c.name.trim().slice(0, 40) || '코스', kind: c.kind, lengthM, key: keyOf(c), startGate: gate(c.startGate), finishGate: gate(c.finishGate), sectorBoundsM: c.sectorBoundsM, line };
}

function newTeamCourse(r: RoomCourse, id: string): Course {
  return {
    id,
    name: r.name,
    kind: r.kind,
    source: 'team',
    origin: { lat: r.startGate.lat, lon: r.startGate.lon },
    startGate: gate(r.startGate),
    finishGate: gate(r.finishGate),
    centerline: r.line.length >= 2 ? expandLine(r.line, 1) : null,
    lengthM: r.lengthM || null,
    sectorBoundsM: r.sectorBoundsM,
    version: 1,
  };
}

/** 출발 때: 받아 둔 코스를 폰에서 다시 찾는다 (고쳤으면 고친 판). 그사이 지웠으면 다시 잇는다 (검토 지적: 지운 코스로 주행했다) */
export async function refreshTeamCourse(local: Course, r: RoomCourse): Promise<Course> {
  return (await getDriveRepo().getCourse(local.id)) ?? (await courseForRoom(r));
}

/** 팀원: 받은 코스를 폰의 코스로 잇는다 — 같은 기본 코스·같은 공개 코스·같은 모양이 있으면 그 코스, 없으면 한도를 보고 새로 담는다 */
export async function courseForRoom(r: RoomCourse): Promise<Course> {
  const drive = getDriveRepo();
  const list = await drive.listCourses();
  const k = r.key;
  if (k?.startsWith('b:')) {
    const b = list.find((c) => c.builtin === k.slice(2));
    if (b) return b;
  } else if (k?.startsWith('s:')) {
    const id = k.slice(2);
    const s = list.find((c) => c.shared?.id === id || c.publishedId === id);
    if (s) return s;
  }
  const fresh = newTeamCourse(r, crypto.randomUUID());
  const same = list.find((c) => sameCourseShape(c, fresh));
  if (same) return same;
  await assertCourseRoom(drive);
  await drive.putCourse(fresh);
  await loadCourses();
  return fresh;
}
