import type { ComponentType } from 'react';
import { finishInterruptedSession, resumeInterrupted, useRecording } from '../app/recording';
import { InterruptedPrompt } from './components/InterruptedPrompt';
import { useHashPath } from './router';
import { HomeScreen } from './screens/HomeScreen';
import { RecorderTestScreen } from './screens/RecorderTestScreen';

/** 경로 → 화면. 화면은 마일스톤마다 추가한다. */
const screens: Record<string, ComponentType> = {
  '/': HomeScreen,
  '/dev/recorder': RecorderTestScreen,
};

export function App() {
  const path = useHashPath();
  const { interrupted, phase } = useRecording();
  // 알 수 없는 경로는 홈으로 보여준다.
  const Screen = screens[path] ?? HomeScreen;
  // 사양서 9장: 다시 열면 중단된 기록을 이어서 할지 묻는다.
  const pending = phase === 'idle' ? interrupted[0] : undefined;
  return (
    <>
      <Screen />
      {pending && (
        <InterruptedPrompt
          startedAt={pending.startedAt}
          onResume={() => {
            window.location.hash = '#/dev/recorder';
            resumeInterrupted(pending.id);
          }}
          onFinish={() => void finishInterruptedSession(pending.id)}
        />
      )}
    </>
  );
}
