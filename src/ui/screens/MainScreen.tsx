// 메인 · 주행 전 (사양서 8.2, 디자인 시안 Main): 감지된 코스, 주행 시작, 지도 타일 없는 지도.
// 친구 위치 공유·같이 달리기는 2·3단계라 넣지 않는다.
import { useEffect, useMemo } from 'react';
import { beginPrepare, loadCourses, useDrive } from '../../app/drive';
import { useRecording } from '../../app/recording';
import { useAccount } from '../../app/account';
import { useSync } from '../../app/sync';
import { nearestCourse } from '../../engine/course/nearest';
import { toLocal } from '../../engine/geo';
import { buildInfo } from '../buildInfo';
import { CourseMap } from '../components/CourseMap';
import { Tabbed } from '../components/TabBar';
import { UpdateBanner } from '../components/UpdateBanner';
import { formatKst, formatLapTime, formatLength } from '../format';
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
  const { fix, permission } = useLocationPreview(!busy);
  useEffect(() => {
    void loadCourses();
  }, []);
  const near = useMemo(() => (fix ? nearestCourse(drive.courses, fix.lat, fix.lon) : null), [fix, drive.courses]);
  const course = near?.course ?? null;
  const best = useBestTimes(course ? [course] : []);
  const me = useMemo(() => {
    if (!fix) return null;
    const origin = course?.origin ?? { lat: fix.lat, lon: fix.lon };
    const p = toLocal(origin, fix.lat, fix.lon);
    return { x: p.x, y: p.y };
  }, [fix, course]);

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
        <div className="card card-row">
          <div className="card-col">
            <span className="label-row">
              <IconPin size={14} />
              {course ? '현재 위치에서 감지됨' : fix ? '근처에 저장된 코스 없음' : '현재 위치 확인 중'}
            </span>
            <span className="title">{course ? course.name : '새 코스'}</span>
            <span className="sub">
              {course ? (
                <>
                  {course.kind === 'loop' ? '랩' : '편도'} · {formatLength(course.lengthM)}
                  {best[course.id] != null && (
                    <>
                      {' · 내 베스트 '}
                      <span className="mono">{formatLapTime(best[course.id]!, 3)}</span>
                    </>
                  )}
                </>
              ) : permission === 'denied' ? (
                '위치 권한이 꺼져 있어요. 설정에서 허용해 주세요'
              ) : permission !== 'granted' && !fix ? (
                '주행 시작을 누르면 위치 권한을 물어봐요'
              ) : (
                '달리면 자동으로 코스를 만들어요'
              )}
            </span>
          </div>
          <span className="gps-badge">
            <IconGps size={16} color={fix ? (fix.hAcc <= 10 ? '#3EE08F' : '#FFB224') : '#5E656D'} />
            GPS <span className="mono">{fix ? `${Math.round(fix.hAcc)}m` : '—'}</span>
          </span>
        </div>
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
      <div className="main-map">
        <CourseMap variant="main" course={course} me={me} label={course ? `지도: ${course.name}, 내 위치` : '지도: 내 위치'} />
        {!course && !fix && <div className="map-chip">위치를 받으면 지도에 표시돼요</div>}
        <footer className="build-info">
          버전 {buildInfo.version} · {formatKst(Date.parse(buildInfo.builtAt))} 빌드
        </footer>
      </div>
    </Tabbed>
  );
}
