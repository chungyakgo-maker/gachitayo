// 프로필 사진 동그라미 (사용자 요청 "아주 작은 프사 동그랗게", 설계 2026-11-18 team-drive): 목록 26px, 내 프로필 76px.
// 사진이 없거나 못 받으면 닉네임 첫 글자. 이름이 옆에 같이 나오므로 사진은 읽어 주지 않는다(장식)
import { useState } from 'react';
import { avatarUrl } from '../../app/avatar';

export function Avatar({ id, name, size = 26 }: { id: string | null | undefined; name: string; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const url = avatarUrl(id);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.46) };
  if (url && broken !== url) {
    return <img className="avatar" src={url} alt="" role="presentation" width={size} height={size} loading="lazy" decoding="async" style={style} onError={() => setBroken(url)} />;
  }
  return (
    <span className="avatar avatar-letter" aria-hidden="true" style={style}>
      {[...name.trim()][0] ?? '?'}
    </span>
  );
}
