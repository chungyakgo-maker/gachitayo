import { useEffect, type ReactElement } from 'react';
import { resumeDrive } from '../app/drive';
import { finishInterruptedSession, useRecording } from '../app/recording';
import { useSettings } from '../app/settings';
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
import { WidgetsScreen } from './screens/WidgetsScreen';

/** 경로 → 화면 */
function route(path: string): ReactElement {
  const summary = /^\/summary\/([^/]+)$/.exec(path);
  if (summary) return <SummaryScreen sessionId={decodeURIComponent(summary[1]!)} />;
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
  // 델타 색 (설정): 화면 전체에 적용
  useEffect(() => {
    document.documentElement.classList.toggle('palette-blue-orange', deltaPalette === 'blue-orange');
  }, [deltaPalette]);
  // 사양서 9장: 다시 열면 중단된 기록을 이어서 할지 묻는다.
  const pending = phase === 'idle' ? interrupted[0] : undefined;
  return (
    <>
      {route(path)}
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
