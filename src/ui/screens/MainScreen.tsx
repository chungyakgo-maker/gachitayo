// 메인 · 주행 전 (사양서 8.2, 디자인 시안 Main): 감지된 코스, 주행 시작, 지도(통신이 되면 OSM 타일, 안 되면 타일 없이),
// 위치 공유 켜기/끄기와 공유 중인 친구 (M8: 사용자 요청으로 2단계에서 앞당김). 같이 달리기는 3단계라 넣지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFriends, watchFriendPositions, loadFriends } from '../../app/friends';
import { beginPrepare, chooseCourse, chooseFreeDrive, getDriveState, loadCourses, prepareWithCourse, useDrive } from '../../app/drive';
import { DriveChoiceSheet } from '../components/DriveChoiceSheet';
import { updateSettings, useSettings } from '../../app/settings';
import { useRecording } from '../../app/recording';
import { useAccount } from '../../app/account';
import { useSync } from '../../app/sync';
import { nearestCourse } from '../../engine/course/nearest';
import { MainMap } from '../components/MainMap';
import { ShareToggle } from '../components/ShareToggle';
import { Tabbed } from '../components/TabBar';
import { UpdateBanner } from '../components/UpdateBanner';
import { useLocationPreview } from '../hooks/useLocationPreview';
import { IconArrowRight, IconCloud, IconWarn } from '../icons';
import type { GpsState } from '../components/GpsIcon';
import { useOverlayInsets } from '../hooks/useOverlayInsets';
import { usePwaUpdate } from '../pwa/usePwaUpdate';
import { CourseChips } from '../components/CourseChips';
import { CourseSheet } from '../components/CourseSheet';
import { MainSearch } from '../components/MainSearch';
import { filterCourses } from '../../app/courseFilter';
import { isFavorite, tagsOf, useCoursePrefs } from '../../app/coursePrefs';
import { usePopular } from '../../app/popular';
import { handOffDestination } from '../../app/routeNav';

export function MainScreen() {
  const { needRefresh, update } = usePwaUpdate();
  const rec = useRecording();
  const drive = useDrive();
  const settings = useSettings();
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
  // 주행 시작 때 묻는다 (사용자 요청): 근처에 코스가 있으면 코스 주행, 늘 일반 기록 주행 / 일반 주행(기록 안 남김)
  const [ask, setAsk] = useState(false);
  const baseRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLElement>(null);
  const ins = useOverlayInsets(baseRef, topRef, tabRef);
  // 코스 둘러보기 (설계 2026-11-16 course-browse): 분류 칩, 즐겨찾기 보라, 코스 누르면 창, 맨 위 검색
  const prefs = useCoursePrefs();
  const popular = usePopular(settings.popularPeriod, settings.courseFilter === 'popular');
  const shown = useMemo(
    () => filterCourses(drive.courses, settings.courseFilter, { isFavorite: (c) => isFavorite(c, prefs), tagsOf: (c) => tagsOf(c, prefs) }, popular.rows).map((x) => x.course),
    [drive.courses, settings.courseFilter, prefs, popular.rows],
  );
  const favorites = useMemo(() => new Set(drive.courses.filter((c) => isFavorite(c, prefs)).map((c) => c.id)), [drive.courses, prefs]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const sheetCourse = sheetId ? (drive.courses.find((c) => c.id === sheetId) ?? null) : null;
  const [searching, setSearching] = useState(false);
  const from = fix ? { lat: fix.lat, lon: fix.lon } : null;

  // 지도가 화면 전체, 위 카드·아래 탭은 얹는다. 내 위치는 가려지지 않은 영역의 가운데 (사용자 요청)
  const gps: GpsState = permission === 'denied' ? 'weak' : !fix ? 'none' : fix.hAcc <= 10 ? 'good' : fix.hAcc <= 30 ? 'wait' : 'weak';
  return (
    <Tabbed path="/" overlay tabbarRef={tabRef}>
      <UpdateBanner visible={needRefresh && !busy} onUpdate={update} />
      <div className="main-full" ref={baseRef}>
      <div className="main-top overlay" ref={topRef}>
        {busy && (
          <a
            className="notice warn"
            href={drive.phase === 'preparing' ? '#/prepare' : drive.phase === 'idle' ? '#/dev/recorder' : '#/drive'}
            style={{ textDecoration: 'none' }}
          >
            {drive.phase === 'idle' ? '센서 기록 테스트가 진행 중이에요 · 돌아가기' : drive.replay ? '재생 중이에요 · 돌아가기' : '진행 중인 주행이 있어요 · 돌아가기'}
          </a>
        )}
        {/* 맨 위 "새 코스"·"현재 위치에서 감지됨" 카드 대신 목적지 검색 (사용자 요청). 근처 코스는 주행 시작 고르기에서 */}
        <MainSearch
          from={from}
          onOpenChange={setSearching}
          onPick={(p) => {
            handOffDestination({ lat: p.lat, lon: p.lon, name: p.name, kind: 'search' });
            window.location.hash = '#/destination';
          }}
        />
        {permission === 'denied' && <span className="notice">위치 권한이 꺼져 있어요. 설정에서 허용해 주세요</span>}
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
        {!searching && (
          <>
        <button type="button" className="primary-btn start" onClick={() => setAsk(true)}>
          <span>주행 시작</span>
          <IconArrowRight size={26} />
        </button>
            <CourseChips
              filter={settings.courseFilter}
              period={settings.popularPeriod}
              onFilter={(f) => updateSettings({ courseFilter: f })}
              onPeriod={(p) => updateSettings({ popularPeriod: p })}
            />
            {settings.courseFilter === 'popular' && popular.error && <span className="notice">{popular.error}</span>}
            {settings.courseFilter === 'popular' && popular.rows && shown.length === 0 && <span className="notice">이 기간에 달린 기록이 아직 없어요</span>}
          </>
        )}
      </div>
      <MainMap
        course={null}
        courses={shown}
        favorites={favorites}
        onCourseTap={setSheetId}
        me={fix}
        label="지도: 코스와 내 위치 (코스 선을 누르면 출발점 안내)"
        friends={friendsOn ? fr.positions : []}
        insetTop={ins.top}
        insetBottom={ins.bottom}
        gps={gps}
        gpsAcc={fix?.hAcc ?? null}
      >
        <div className="map-controls">
          <div className="map-chip-row">
            {friendsOn && <ShareToggle variant="map" />}
          </div>
          {friendsOn && fr.error && fr.sharing && <div className="map-chip">{fr.error}</div>}
        </div>
      </MainMap>
      </div>
      {sheetCourse && (
        <CourseSheet
          course={sheetCourse}
          from={from}
          onClose={() => setSheetId(null)}
          onStartPoint={() => {
            setSheetId(null);
            handOffDestination({ lat: sheetCourse.startGate.lat, lon: sheetCourse.startGate.lon, name: `${sheetCourse.name} · 출발점`, kind: 'course-start' });
            window.location.hash = '#/destination';
          }}
          // 아이폰 모션 권한은 탭 처리 안에서 물어야 하므로 이 탭에서 바로 준비를 시작한다
          // 이미 주행 중이면 코스를 바꾸지 않고 준비 화면으로만 (검토 지적: 진행 중인 주행의 코스가 바뀌었다)
          onDrive={() => {
            setSheetId(null);
            prepareWithCourse(sheetCourse);
          }}
        />
      )}
      {ask && (
        <DriveChoiceSheet
          course={course}
          onClose={() => setAsk(false)}
          // 아이폰 모션 권한은 탭 처리 안에서 물어야 하므로 고른 그 탭에서 바로 준비를 시작한다
          onChoose={(c) => {
            setAsk(false);
            beginPrepare();
            if (getDriveState().phase === 'preparing') chooseCourse(c);
          }}
          onFree={() => {
            setAsk(false);
            beginPrepare();
            if (getDriveState().phase === 'preparing') chooseFreeDrive();
          }}
          // 목적지로 주행: 목적지를 고른 뒤 "이 경로로 출발"을 누르는 탭에서 준비를 연다
          onDestination={() => {
            setAsk(false);
            window.location.hash = '#/destination';
          }}
        />
      )}
    </Tabbed>
  );
}
