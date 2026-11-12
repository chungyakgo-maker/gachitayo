import { buildInfo } from '../buildInfo';
import { formatKst } from '../format';

export function HomeScreen() {
  return (
    <main className="home">
      <h1 className="home-title">같이타요</h1>
      <p className="home-sub">주행 기록기 · 1단계 개발 중</p>
      <footer className="build-info">
        버전 {buildInfo.version} · {formatKst(Date.parse(buildInfo.builtAt))} 빌드
      </footer>
    </main>
  );
}
