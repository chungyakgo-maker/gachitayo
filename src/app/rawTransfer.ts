// PC에서 내 기록 보기 (질문 6 결정 "가"): 폰 분석 화면에서 원본 파일(+코스)을 내보내고, PC 기록 탭에서 가져온다.
// 가져온 기록은 그 기기에만 두고 서버에는 올리지 않는다. 같은 코스로 다시 계산해 폰과 같은 랩이 나온다.
import { serverConfig } from '../server/config';
import { diagnoseCalibration, type CalDiagnosis } from '../engine/diagnose/calibration';
import { gunzipJson, gzipJson } from '../storage/gzip';
import { buildRawFile, readRawFile, type RawFileV1 } from '../storage/rawFile';
import { rawFileName } from '../storage/exportFile';
import { getAuth } from './account';
import { processSession } from './drive';
import { getDriveRepo, getRepo, refreshSessions } from './recording';

/** 이 기록의 원본 (폰에 있으면 폰에서, 정리했으면 서버에서) */
export async function loadRawOf(sessionId: string): Promise<RawFileV1> {
  const repo = getRepo();
  const session = await repo.get(sessionId);
  if (!session) throw new Error('기록을 찾을 수 없어요');
  const chunks = await repo.chunks(sessionId);
  if (chunks.length > 0) return buildRawFile(session, chunks);
  const auth = getAuth();
  if (!auth || !serverConfig.apiUrl || !session.uploadedAt) throw new Error('이 기록의 원본이 폰에 없어요');
  const r = await fetch(`${serverConfig.apiUrl}/files/${auth.userId}/${session.id}.raw.json.gz`, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!r.ok) throw new Error(`원본을 서버에서 받지 못했어요 (${r.status})`);
  return readRawFile(await gunzipJson(new Uint8Array(await r.arrayBuffer()))).file;
}

/** 폰에서: 이 기록의 원본 파일(.raw.json.gz)에 코스를 넣어 만든다. 폰에서 원본을 정리했으면 서버에서 받는다 */
export async function prepareRawExport(sessionId: string): Promise<File> {
  const session = await getRepo().get(sessionId);
  if (!session) throw new Error('기록을 찾을 수 없어요');
  const raw = await loadRawOf(sessionId);
  const course = session.courseId ? await getDriveRepo().getCourse(session.courseId) : undefined;
  const file: RawFileV1 = course ? { ...raw, course } : raw;
  return new File([await gzipJson(file)], rawFileName(session, 'json.gz'), { type: 'application/gzip' });
}

/** G 보정 진단 (분석 화면): 원본으로 보정이 어디서 막혔는지 */
export async function loadCalDiagnosis(sessionId: string): Promise<CalDiagnosis> {
  const { gps, motion } = readRawFile(await loadRawOf(sessionId));
  return diagnoseCalibration(gps, motion);
}

/** PC(또는 다른 기기)에서: 원본 파일을 가져와 이 기기에만 저장하고 계산한다. 새 기록 id를 돌려준다 */
export async function importRawFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  let value: unknown;
  try {
    value = gz ? await gunzipJson(bytes) : JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('원본 파일을 읽지 못했어요 (.raw.json.gz 또는 .raw.json)');
  }
  const { file: raw, gps, motion, events, channels } = readRawFile(value);
  if (gps.length === 0) throw new Error('GPS 기록이 없는 원본이에요');
  const repo = getRepo();
  const drive = getDriveRepo();
  // 같은 기기에 이미 있으면 새 id로 (덮어쓰지 않는다)
  const id = (await repo.get(raw.sessionId)) ? crypto.randomUUID() : raw.sessionId;
  let courseId: string | null = null;
  let courseVersion: number | null = null;
  if (raw.course) {
    const have = await drive.getCourse(raw.course.id);
    if (!have || have.version < raw.course.version) await drive.putCourse(raw.course);
    courseId = raw.course.id;
    courseVersion = raw.course.version;
  }
  const lastT = Math.max(gps.at(-1)!.tRecv, motion.at(-1)?.t ?? 0);
  await repo.create({
    id,
    courseId,
    courseVersion,
    status: 'finished',
    startedAt: raw.startedAtEpochMs,
    endedAt: raw.startedAtEpochMs + lastT,
    device: raw.device,
    calibration: null,
    summary: null,
    imported: true,
  });
  await repo.putChunk({ sessionId: id, seq: 0, gps, rawMotion: motion, events, channels });
  await refreshSessions();
  await processSession(id);
  return id;
}
