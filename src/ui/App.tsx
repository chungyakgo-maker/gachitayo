import { useEffect, type ReactElement } from 'react';
import { resumeDrive } from '../app/drive';
import { finishInterruptedSession, useRecording } from '../app/recording';
import { useSettings } from '../app/settings';
import { useAccount } from '../app/account';
import { InterruptedPrompt } from './components/InterruptedPrompt';
import { useHashPath } from './router';
import { CoursesScreen } from './screens/CoursesScreen';
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

/** 경로 → 화면 */
function route(path: string): ReactElement {
  const summary = /^\/summary\/([^/]+)$/.exec(path);
  if (summary) return <SummaryScreen sessionId={decodeURIComponent(summary[1]!)} />;
  const analysis = /^\/analysis\/([^/]+)$/.exec(path);
  if (analysis) return <AnalysisScreen sessionId={decodeURIComponent(analysis[1]!)} />;
  const course = /^\/course\/([^/]+)$/.exec(path);
  if (course) return <CourseDetailScreen courseId={decodeURIComponent(course[1]!)} />;
  if (path === '/course-new') return <NewCourseScreen />;
  switch (path) {
    case '/courses':
      return <CoursesScreen />;
    case '/history':
      return <HistoryScreen />;
    case '/settings':
      return <SettingsScreen />;
    case '/settings/widgets':
      return <WidgetsScreen back="#/settings" />;
    case '/prepare':
      return <PrepareScreen />;
    case '/prepare/widgets':
      return <WidgetsScreen back="#/prepare" />;
    case '/drive':
      return <DriveScreen />;
    case '/auth/kakao':
      return <KakaoAuthScreen />;
    case '/dev/recorder':
      return <RecorderTestScreen />;
    case '/dev/replay':
      return <ReplayScreen />;
    default:
      // 알 수 없는 경로는 메인으로 보여준다.
      return <MainScreen />;
  }
}

export function App() {
  const path = useHashPath();
  const { interrupted, phase } = useRecording();
  const { deltaPalette } = useSettings();
  const { onboarded } = useAccount();
  // 델타 색 (설정): 화면 전체에 적용
  useEffect(() => {
    document.documentElement.classList.toggle('palette-blue-orange', deltaPalette === 'blue-orange');
  }, [deltaPalette]);
  // 사양서 9장: 다시 열면 중단된 기록을 이어서 할지 묻는다.
  const pending = phase === 'idle' ? interrupted[0] : undefined;
  return (
    <>
      {/* 첫 실행 안내 (사양서 8.1). 개발자 메뉴와 카카오 로그인에서 돌아온 화면은 그대로 연다 */}
      {!onboarded && !path.startsWith('/dev/') && !path.startsWith('/auth/') ? <WelcomeScreen /> : route(path)}
      {pending && (
        <InterruptedPrompt
          startedAt={pending.startedAt}
          onResume={() => void resumeDrive(pending.id)}
          onFinish={() => void finishInterruptedSession(pending.id)}
        />
      )}
    </>
  );
}
