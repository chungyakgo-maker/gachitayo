// 그룹 주행 방 대기실 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md, 시안 "방장 대기실"):
// 방 코드·카톡 초대·링크 복사, 주행 순서(방장은 ↑↓), 차 간격(방장은 − +), 목적지(방장은 정하기·바꾸기), 출발 준비, 방 나가기.
// 주행 중에도 열 수 있다 (방장이 중간에 목적지를 정해 모두에게 보낸다)
import { useState } from 'react';
import { beginPrepare, chooseCourse, getDriveState, useDrive } from '../../app/drive';
import {
  groupColor,
  groupErrorText,
  hasPendingRoute,
  isGroupHost,
  leaveGroupRoom,
  moveGroupMember,
  reopenRouteOffer,
  setGroupGap,
  startGroupNav,
  useGroup,
} from '../../app/group';
import { copyInviteLink, formatRoomCode, kakaoShareReady, shareInvite } from '../../app/kakaoShare';
import { GroupSheet } from '../components/GroupSheet';
import { IconBack } from '../icons';

const GAP_MIN = 1;
const GAP_MAX = 10;

export function GroupScreen() {
  const g = useGroup();
  const drive = useDrive();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [sheet, setSheet] = useState(false);
  const room = g.room;
  const driving = drive.phase !== 'idle' && !drive.replay;
  const back = driving ? (drive.phase === 'preparing' ? '#/prepare' : '#/drive') : '#/';

  if (!room) {
    return (
      <main className="page">
        <header className="page-head">
          <a className="back-btn" href={back} aria-label="뒤로">
            <IconBack size={24} />
          </a>
          <h1 style={{ flex: 1 }}>그룹 주행</h1>
        </header>
        <div className="empty">들어가 있는 방이 없어요</div>
        <button type="button" className="primary-btn" onClick={() => setSheet(true)}>
          방 만들기 · 코드로 들어가기
        </button>
        {sheet && <GroupSheet onClose={() => setSheet(false)} />}
      </main>
    );
  }

  const host = isGroupHost(g);
  const members = [...room.members].sort((a, b) => a.order - b.order);
  const act = (f: () => Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    f().then(
      () => setBusy(false),
      (e: unknown) => {
        setNote(groupErrorText(e));
        setBusy(false);
      },
    );
  };
  const invite = () =>
    void shareInvite({ code: room.code, destName: room.dest?.name ?? null, count: members.length }).then((r) => {
      if (r === 'copied') setNote('초대 링크를 복사했어요. 카톡에 붙여 넣어 보내 주세요');
      else if (r === 'failed') setNote(`공유하지 못했어요. 방 코드 ${formatRoomCode(room.code)}를 알려 주세요`);
    });
  const copy = () => void copyInviteLink(room.code).then((ok) => setNote(ok ? '초대 링크를 복사했어요' : `복사하지 못했어요. 방 코드 ${formatRoomCode(room.code)}를 알려 주세요`));
  // 출발 준비: 아이폰 모션 권한은 탭 처리 안에서 물어야 하므로 이 탭에서 바로 준비를 연다 (일반 기록 주행, 받은 경로가 있으면 경로 안내)
  const start = () => {
    beginPrepare();
    if (getDriveState().phase !== 'preparing') return;
    chooseCourse(null);
    startGroupNav();
  };
  const destWaiting = !!room.dest && room.routeVersion > g.acceptedVersion;

  return (
    <main className="page" style={{ gap: 12 }}>
      <header className="page-head">
        <a className="back-btn" href={back} aria-label="뒤로">
          <IconBack size={24} />
        </a>
        <h1 style={{ flex: 1 }}>그룹 주행 방</h1>
        <span className="sub">{members.length}명</span>
      </header>
      {!g.connected && (
        <span className="sub" role="status">
          방에 연결하는 중…
        </span>
      )}

      <section className="card card-col" style={{ gap: 10 }}>
        <span className="label">방 코드</span>
        <div className="group-code" aria-label={`방 코드 ${room.code.split('').join(' ')}`}>
          {formatRoomCode(room.code)}
        </div>
        <div className="group-row">
          <button type="button" className="kakao-btn" style={{ flex: 1.5 }} onClick={invite}>
            {kakaoShareReady() ? '카카오톡으로 초대' : '초대 보내기'}
          </button>
          <button type="button" className="btn" style={{ flex: 1, minHeight: 52 }} onClick={copy}>
            링크 복사
          </button>
        </div>
      </section>
      {note && (
        <span className="notice" role="status">
          {note}
        </span>
      )}

      <section className="card card-row" style={{ gap: 8 }}>
        <span className="card-col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <span className="label">목적지 · 모두 같은 경로</span>
          <strong style={{ fontSize: 17 }}>{room.dest?.name ?? '없음'}</strong>
          <span className="sub">
            {!room.dest
              ? host
                ? '없어도 출발할 수 있어요. 주행 중에도 정할 수 있어요'
                : '방장이 정하면 알려 드려요'
              : destWaiting && !host
                ? '아직 이 경로를 받지 않았어요'
                : hasPendingRoute()
                  ? '출발하면 이 경로로 안내해요'
                  : '이 경로로 안내 중이거나 받았어요'}
          </span>
        </span>
        {host ? (
          <a className="btn small" href="#/group/destination" style={{ textDecoration: 'none' }}>
            {room.dest ? '바꾸기' : '정하기'}
          </a>
        ) : (
          g.later && (
            <button type="button" className="btn small" onClick={reopenRouteOffer}>
              경로 받기
            </button>
          )
        )}
      </section>

      <section className="card-col" style={{ gap: 8 }} aria-label="주행 순서">
        <span className="label">{host ? '주행 순서 · 방장이 바꿔요 (↑↓)' : '주행 순서'}</span>
        {members.map((m, i) => {
          const me = m.userId === g.me;
          const name = me ? `${m.nickname} (나)` : m.nickname;
          return (
            <div key={m.userId} className={`group-member${me ? ' me' : ''}`}>
              <span className="group-num" style={{ background: groupColor(m.color) }}>
                {m.order}
              </span>
              <span className="name">{name}</span>
              {m.host && <span className="group-badge">방장</span>}
              {host && (
                <span className="group-arrows">
                  <button type="button" aria-label={`${m.nickname} 앞으로`} disabled={busy || i === 0} onClick={() => act(() => moveGroupMember(m.userId, -1))}>
                    ↑
                  </button>
                  <button type="button" aria-label={`${m.nickname} 뒤로`} disabled={busy || i === members.length - 1} onClick={() => act(() => moveGroupMember(m.userId, 1))}>
                    ↓
                  </button>
                </span>
              )}
            </div>
          );
        })}
        {members.length === 1 && <span className="sub">초대한 사람이 들어오면 여기 보여요 (최대 8명)</span>}
      </section>

      <section className="card card-col" style={{ gap: 8 }}>
        <span className="label">차 간격 (앞 차와)</span>
        {host ? (
          <div className="group-stepper">
            <button type="button" aria-label="차 간격 줄이기" disabled={busy || room.gapS <= GAP_MIN} onClick={() => act(() => setGroupGap(Math.max(GAP_MIN, room.gapS - 0.5)))}>
              −
            </button>
            <span className="v" aria-live="polite">
              {room.gapS.toFixed(1)}초
            </span>
            <button type="button" aria-label="차 간격 늘리기" disabled={busy || room.gapS >= GAP_MAX} onClick={() => act(() => setGroupGap(Math.min(GAP_MAX, room.gapS + 0.5)))}>
              +
            </button>
          </div>
        ) : (
          <span className="mono" style={{ fontSize: 22, fontWeight: 800 }}>
            {room.gapS.toFixed(1)}초
          </span>
        )}
        <span className="sub">{host ? '1초부터 0.5초 단위 · 모두에게 같은 값' : '방장이 정해요 · 주행 중 칸 1에 앞 차와의 간격이 보여요'}</span>
      </section>

      <div className="group-bottom">
        {driving ? (
          <a className="primary-btn" href={back} style={{ textDecoration: 'none' }}>
            주행으로 돌아가기
          </a>
        ) : (
          <>
            <button type="button" className="primary-btn" onClick={start}>
              출발 준비
            </button>
            <span className="sub" style={{ textAlign: 'center' }}>
              각자 출발 준비를 누르고 출발해요 · 주행 중 지도에 모두 보여요
            </span>
          </>
        )}
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            if (!leaving) {
              setLeaving(true);
              return;
            }
            void leaveGroupRoom().then(() => {
              window.location.hash = driving ? back : '#/';
            });
          }}
        >
          {leaving ? '한 번 더 누르면 방에서 나가요' : '방 나가기'}
        </button>
      </div>
    </main>
  );
}
