import { buildInfo } from '../buildInfo';
import { UpdateBanner } from '../components/UpdateBanner';
import { formatKst } from '../format';
import { usePwaUpdate } from '../pwa/usePwaUpdate';

export function HomeScreen() {
  // 새 버전 안내는 홈 화면에서만 보여준다 (주행 화면에서는 적용하지 않음).
  const { needRefresh, update } = usePwaUpdate();
  return (
    <main className="home">
      <UpdateBanner visible={needRefresh} onUpdate={update} />
      <h1 className="home-title">같이타요</h1>
      <p className="home-sub">주행 기록기 · 1단계 개발 중</p>
      <a className="dev-link" href="#/dev/recorder">
        개발자: 센서 기록 테스트
      </a>
      <footer className="build-info">
        버전 {buildInfo.version} · {formatKst(Date.parse(buildInfo.builtAt))} 빌드
      </footer>
    </main>
  );
}
