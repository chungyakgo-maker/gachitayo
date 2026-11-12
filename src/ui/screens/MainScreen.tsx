// 메인 · 주행 전 (사양서 8.2, 디자인 시안 Main): 감지된 코스, 주행 시작, 지도(통신이 되면 OSM 타일, 안 되면 타일 없이),
// 위치 공유 켜기/끄기와 공유 중인 친구 (M8: 사용자 요청으로 2단계에서 앞당김). 같이 달리기는 3단계라 넣지 않는다.
import { useEffect, useMemo } from 'react';
import { useFriends, watchFriendPositions, loadFriends } from '../../app/friends';
import { beginPrepare, loadCourses, useDrive } from '../../app/drive';
import { useRecording } from '../../app/recording';
import { useAccount } from '../../app/account';
import { useSync } from '../../app/sync';
import { nearestCourse } from '../../engine/course/nearest';
import { MainMap } from '../components/MainMap';
import { ShareToggle } from '../components/ShareToggle';
import { Tabbed } from '../components/TabBar';
import { UpdateBanner } from '../components/UpdateBanner';
import { formatLapTime, formatLength } from '../format';
import { useLocationPreview } from '../hooks/useLocationPreview';
import { IconArrowRight, IconCloud, IconGps, IconPin, IconSettings, IconWarn } from '../icons';
import { usePwaUpdate } from '../pwa/usePwaUpdate';
import { useBestTimes } from './useBestTimes';

export function MainScreen() {
  const { needRefresh, update } = usePwaUpdate();
  const rec = useRecording();
  const drive = useDrive();
  const sync = useSync();
  const acc = useAccount();
  const busy = drive.phase !== 'idle' || rec.phase !== 'idle';
  // 주행·기록 중이 아니면 새 버전을 바로 적용한다 (사용자 불편: 업데이트를 눌러야만 새 버전이 들어왔다).
  // 주행 중에는 그대로 두고, 주행이 끝나 메인으로 돌아오면 적용한다
  useEffect(() => {
    if (needRefresh && !busy) update();
  }, [needRefresh, busy, update]);
  const { fix, permission } = useLocationPreview(!busy);
  useEffect(() => {
    void loadCourses();
  }, []);
  const fr = useFriends();
  const friendsOn = acc.status === 'ready';
  useEffect(() => {
    if (!friendsOn) return;
    void loadFriends();
    return watchFriendPositions();
  }, [friendsOn]);
  const near = useMemo(() => (fix ? nearestCourse(drive.courses, fix.lat, fix.lon) : null), [fix, drive.courses]);
  const course = near?.course ?? null;
  const best = useBestTimes(course ? [course] : []);

  return (
    <Tabbed path="/">
      <UpdateBanner visible={needRefresh && !busy} onUpdate={update} />
      <div className="main-top">
        <header className="page-head">
          <h1 className="big">같이타요</h1>
          <a className="icon-btn" href="#/settings" aria-label="설정">
            <IconSettings />
          </a>
        </header>
        {busy && (
          <a
            className="notice warn"
            href={drive.phase === 'preparing' ? '#/prepare' : drive.phase === 'idle' ? '#/dev/recorder' : '#/drive'}
            style={{ textDecoration: 'none' }}
          >
            {drive.phase === 'idle' ? '센서 기록 테스트가 진행 중이에요 · 돌아가기' : drive.replay ? '재생 중이에요 · 돌아가기' : '진행 중인 주행이 있어요 · 돌아가기'}
          </a>
        )}
        {course ? (
          <div className="card card-row">
            <div className="card-col">
              <span className="label-row">
                <IconPin size={14} />
                현재 위치에서 감지됨
              </span>
              <span className="title">{course.name}</span>
              <span className="sub">
                {course.kind === 'loop' ? '랩' : '편도'} · {formatLength(course.lengthM)}
                {best[course.id] != null && (
                  <>
                    {' · 내 베스트 '}
                    <span className="mono">{formatLapTime(best[course.id]!, 3)}</span>
                  </>
                )}
              </span>
            </div>
          <span className="gps-badge">
            <IconGps size={16} color={fix ? (fix.hAcc <= 10 ? '#3EE08F' : '#FFB224') : '#5E656D'} />
            GPS <span className="mono">{fix ? `${Math.round(fix.hAcc)}m` : '—'}</span>
          </span>
          </div>
        ) : (
          // 근처에 코스가 없으면 한 줄로 작게 (사용자 요청)
          <div className="card compact" aria-label="새 코스">
            <div className="card-row">
              <span className="label-row compact-line">
                <IconPin size={14} />
                <strong>새 코스</strong>
                <span className="dim">· {fix ? '근처 코스 없음' : '위치 확인 중'}</span>
              </span>
              <span className="gps-badge">
                <IconGps size={16} color={fix ? (fix.hAcc <= 10 ? '#3EE08F' : '#FFB224') : '#5E656D'} />
                GPS <span className="mono">{fix ? `${Math.round(fix.hAcc)}m` : '—'}</span>
              </span>
            </div>
            {permission === 'denied' ? (
              <span className="sub">위치 권한이 꺼져 있어요. 설정에서 허용해 주세요</span>
            ) : permission !== 'granted' && !fix ? (
              <span className="sub">주행 시작을 누르면 위치 권한을 물어봐요</span>
            ) : null}
          </div>
        )}
        {acc.status === 'none' && acc.lost && (
          <a className="notice warn" href="#/settings" style={{ textDecoration: 'none' }}>
            <IconWarn size={20} />
            계정 연결이 끊겨 업로드할 수 없어요 · 설정에서 확인
          </a>
        )}
        {sync.enabled && sync.pending > 0 && (
          <a className="notice" href="#/settings" style={{ textDecoration: 'none' }}>
            <IconCloud size={20} color="#FFB224" />
            업로드 대기 {sync.pending}건 · 통신이 연결되면 자동으로 올라갑니다
          </a>
        )}
        <button type="button" className="primary-btn start" onClick={beginPrepare}>
          <span>주행 시작</span>
          <IconArrowRight size={26} />
        </button>
      </div>
      <MainMap course={course} me={fix} label={course ? `지도: ${course.name}, 내 위치` : '지도: 내 위치'} friends={friendsOn ? fr.positions : []}>
        <div className="map-controls">
          {friendsOn && <ShareToggle variant="map" />}
          {!course && !fix && <div className="map-chip">위치를 받으면 지도에 표시돼요</div>}
          {friendsOn && fr.error && fr.sharing && <div className="map-chip">{fr.error}</div>}
        </div>
      </MainMap>
    </Tabbed>
  );
}
