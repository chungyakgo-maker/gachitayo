// 주행 지도에 친구 위치 보이기·끄기 (사용자 요청). 주행 준비와 설정에서 쓴다. 내 위치 공유와는 따로다.
import { updateSettings, useSettings } from '../../app/settings';

export function DriveFriendsToggle() {
  const s = useSettings();
  return (
    <section className="card-col" style={{ gap: 8 }} aria-label="주행 지도에 친구 위치">
      <span className="label">주행 지도에 친구 위치</span>
      <div className="segmented small" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {(
          [
            [true, '보이기'],
            [false, '끄기'],
          ] as const
        ).map(([v, label]) => (
          <button key={label} type="button" aria-pressed={s.driveFriends === v} onClick={() => updateSettings({ driveFriends: v })}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
