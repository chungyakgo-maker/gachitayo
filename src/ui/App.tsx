import { useEffect, useState, type ReactElement } from 'react';
import { isApp } from '../platform';
import { SplashIntro } from './components/SplashIntro';
import { resumeDrive } from '../app/drive';
import { finishInterruptedSession, useRecording } from '../app/recording';
import { useSettings } from '../app/settings';
import { useAccount } from '../app/account';
import { InterruptedPrompt } from './components/InterruptedPrompt';
import { useHashPath } from './router';
import { CoursesScreen } from './screens/CoursesScreen';
import { DestinationScreen } from './screens/DestinationScreen';
import { DriveScreen } from './screens/DriveScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { MainScreen } from './screens/MainScreen';
import { PrepareScreen } from './screens/PrepareScreen';
import { RecorderTestScreen } from './screens/RecorderTestScreen';
import { ReplayScreen } from './screens/ReplayScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { AnalysisScreen } from './screens/AnalysisScreen';
import { CourseDetailScreen } from './screens/CourseDetailScreen';
import { NewCourseScreen } from './screens/NewCourseScreen';
import { WidgetsScreen } from './screens/WidgetsScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { KakaoAuthScreen } from './screens/KakaoAuthScreen';
import { GroupScreen } from './screens/GroupScreen';
import { JoinScreen } from './screens/JoinScreen';
import { RouteOfferSheet } from './components/RouteOfferSheet';
import { rememberPendingLink, takePendingLink } from '../app/pendingJoin';
import { TeamEditScreen } from './screens/TeamEditScreen';
import { TeamDriveLinkScreen } from './screens/TeamDriveLinkScreen';
import { FriendInviteScreen } from './screens/FriendInviteScreen';
import { HelpScreen } from './screens/HelpScreen';

const safeDecode = (v: string): string => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** 경로 → 화면 */
function route(path: string): ReactElement {
  const summary = /^\/summary\/([^/]+)$/.exec(path);
  if (summary) return <SummaryScreen sessionId={decodeURIComponent(summary[1]!)} />;
  const analysis = /^\/analysis\/([^/]+)$/.exec(path);
  if (analysis) return <AnalysisScreen sessionId={decodeURIComponent(analysis[1]!)} />;
  const course = /^\/course\/([^/]+)$/.exec(path);
  if (course) return <CourseDetailScreen courseId={decodeURIComponent(course[1]!)} />;
  if (path === '/course-new') return <NewCourseScreen />;
  // 팀 (설계 2026-11-18 team-drive): 만들기·편집·보기, 팀 주행 알리기 링크, 카톡 친구 초대 링크
  if (path === '/team/new') return <TeamEditScreen teamId={null} />;
  const teamDrive = /^\/team\/([0-9a-f-]{36})\/drive$/.exec(path);
  if (teamDrive) return <TeamDriveLinkScreen teamId={teamDrive[1]!} />;
  const team = /^\/team\/([0-9a-f-]{36})$/.exec(path);
  if (team) return <TeamEditScreen key={team[1]} teamId={team[1]!} />;
  const friend = /^\/friend\/([^/]+)(?:\/([^/]*))?$/.exec(path);
  if (friend) return <FriendInviteScreen code={decodeURIComponent(friend[1]!)} name={safeDecode(friend[2] ?? '')} />;
  const join = /^\/join\/([^/]+)$/.exec(path);
  if (join) return <JoinScreen code={decodeURIComponent(join[1]!)} />;
  switch (path) {
    case '/courses':
      return <CoursesScreen />;
    case '/history':
      return <HistoryScreen />;
    case '/settings':
      return <SettingsScreen />;
    case '/settings/widgets':
      return <WidgetsScreen back="#/settings" />;
    // 도움말 · 기능 알아보기 (설계 2026-11-18 help)
    case '/help':
      return <HelpScreen />;
    case '/prepare':
      return <PrepareScreen />;
    case '/prepare/widgets':
      return <WidgetsScreen back="#/prepare" />;
    case '/drive':
      return <DriveScreen />;
    case '/destination':
      return <DestinationScreen />;
    case '/group':
      return <GroupScreen />;
    case '/group/destination':
      return <DestinationScreen forRoom />;
    case '/auth/kakao':
      return <KakaoAuthScreen />;
    case '/dev/recorder':
      return <RecorderTestScreen />;
    case '/replay':
    case '/dev/replay':
      return <ReplayScreen />;
    default:
      // 알 수 없는 경로는 메인으로 보여준다.
      return <MainScreen />;
  }
}

export function App() {
  const path = useHashPath();
  // 아이폰 앱을 켤 때 한 번 실행 화면 애니메이션 (사용자 결정 2026-11-18: 아이폰 앱만). 그동안 뒤에서 화면을 불러 둔다
  const [splash, setSplash] = useState(isApp);
  const { interrupted, phase } = useRecording();
  const { deltaPalette } = useSettings();
  const { onboarded } = useAccount();
  // 델타 색 (설정): 화면 전체에 적용
  useEffect(() => {
    document.documentElement.classList.toggle('palette-blue-orange', deltaPalette === 'blue-orange');
  }, [deltaPalette]);
  // 카톡으로 받은 링크(방 초대·친구 초대·팀 주행 알리기)로 처음 열었으면 첫 실행 안내(또는 카카오 로그인)를 마친 뒤 그 화면으로
  // (설계 2026-11-16 group-drive, 2026-11-18 team-drive)
  useEffect(() => {
    if (!onboarded) rememberPendingLink(path);
    if (onboarded && path === '/') {
      const link = takePendingLink();
      if (link) window.location.hash = `#${link}`;
    }
  }, [path, onboarded]);
  // 사양서 9장: 다시 열면 중단된 기록을 이어서 할지 묻는다.
  const pending = phase === 'idle' ? interrupted[0] : undefined;
  return (
    <>
      {/* 첫 실행 안내 (사양서 8.1). 개발자 메뉴와 카카오 로그인에서 돌아온 화면은 그대로 연다 */}
      {!onboarded && !path.startsWith('/dev/') && !path.startsWith('/auth/') ? <WelcomeScreen /> : route(path)}
      {onboarded && <RouteOfferSheet />}
      {pending && (
        <InterruptedPrompt
          startedAt={pending.startedAt}
          onResume={() => void resumeDrive(pending.id)}
          onFinish={() => void finishInterruptedSession(pending.id)}
        />
      )}
      {splash && <SplashIntro onDone={() => setSplash(false)} />}
    </>
  );
}
