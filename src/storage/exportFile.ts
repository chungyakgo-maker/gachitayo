// 원본 파일 내보내기. 아이폰은 공유 창(파일에 저장, 메시지 등), 그 밖은 다운로드.
//
// 아이폰 사파리는 공유 창을 버튼 탭 직후에만 열어 준다. 그래서 파일 만들기(시간이 걸림)와
// 공유하기(탭에서 바로 호출)를 두 단계로 나눈다.
import { buildRawFile } from './rawFile';
import { gzipJson } from './gzip';
import type { SessionRepo } from './sessionRepo';
import type { SessionRecord } from '../types/session';

export type RawFileExt = 'json.gz' | 'json';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** gachitayo-YYYYMMDD-HHmm-{id 앞 8자리}.raw.json(.gz), 시각은 KST */
export function rawFileName(session: Pick<SessionRecord, 'id' | 'startedAt'>, ext: RawFileExt): string {
  const d = new Date(session.startedAt + KST_OFFSET_MS);
  const stamp =
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-` +
    `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
  return `gachitayo-${stamp}-${session.id.slice(0, 8)}.raw.${ext}`;
}

/** 1단계: 폰 저장소에서 원본 파일을 만든다. */
export async function prepareRawFile(
  repo: SessionRepo,
  sessionId: string,
  ext: RawFileExt,
): Promise<File> {
  const session = await repo.get(sessionId);
  if (!session) throw new Error(`세션 없음: ${sessionId}`);
  const raw = buildRawFile(session, await repo.chunks(sessionId));
  const name = rawFileName(session, ext);
  if (ext === 'json.gz') {
    return new File([await gzipJson(raw)], name, { type: 'application/gzip' });
  }
  return new File([JSON.stringify(raw)], name, { type: 'application/json' });
}

/** 2단계: 버튼 탭 처리 안에서 바로 부른다. */
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // 공유가 막히면 다운로드로 넘어간다
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
