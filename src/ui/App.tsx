import type { ComponentType } from 'react';
import { useHashPath } from './router';
import { HomeScreen } from './screens/HomeScreen';

/** 경로 → 화면. 화면은 마일스톤마다 추가한다. */
const screens: Record<string, ComponentType> = {
  '/': HomeScreen,
};

export function App() {
  const path = useHashPath();
  // 알 수 없는 경로는 홈으로 보여준다.
  const Screen = screens[path] ?? HomeScreen;
  return <Screen />;
}
