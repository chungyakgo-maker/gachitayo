// 아이폰 앱 실행 화면 애니메이션 2초 (사용자 요청 2026-11-18, 디자인 캔버스 '로고' 페이지 DgoSplash 확정 시안, 아이폰 앱만).
// 앱이 켜질 때 한 번 화면 전체를 덮고, 그동안 뒤에서 앱을 미리 불러온다. 끝나면 살짝 사라지며 메인 화면.
// 시안은 390×844 화면에 그렸다: 그 판을 화면에 맞게 줄이거나 키워 가운데에 놓는다 (바깥은 같은 파란색).
// 아이폰 "동작 줄이기"를 켠 사람에게는 움직임 없이 끝 장면만 잠깐 (애플 권장).
import { useEffect, useRef, useState } from 'react';
import { splashFrame, SPLASH_MS } from '../splash/splashFrame';

const BG = '#3A86FF';
/** 끝나고 사라지는 시간 */
const FADE_MS = 200;
/** 동작 줄이기: 끝 장면만 보여 주는 시간 */
const REDUCED_MS = 700;

const reducedMotion = (): boolean => {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function SplashIntro({ onDone }: { onDone: () => void }) {
  const [reduce] = useState(reducedMotion);
  const [t, setT] = useState(reduce ? SPLASH_MS : 0);
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  // 화면 크기에 맞춘 배율 (시안 판 390×844)
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 390, window.innerHeight / 844) || 1);
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    let raf = 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!reduce && typeof requestAnimationFrame === 'function') {
      const step = (now: number) => {
        const tt = Math.min(SPLASH_MS, now - t0);
        setT(tt);
        if (tt < SPLASH_MS) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    const show = reduce ? REDUCED_MS : SPLASH_MS;
    const fade = setTimeout(() => {
      setT(SPLASH_MS);
      setLeaving(true);
    }, show - FADE_MS);
    const end = setTimeout(() => {
      // 앱을 켤 때부터 깔아 둔 파란 바탕(index.html)을 걷는다
      document.documentElement.classList.remove('app-launch');
      done.current();
    }, show);
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      clearTimeout(fade);
      clearTimeout(end);
    };
  }, [reduce]);

  const f = splashFrame(t);
  return (
    <div className="splash-intro" data-splash style={{ background: BG, opacity: leaving ? 0 : 1, transition: `opacity ${FADE_MS}ms ease-out` }}>
      <div className="splash-board" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <svg
          width="390"
          height="844"
          viewBox="0 0 390 844"
          role="img"
          aria-label="DGO 실행 화면: 차 세 대가 화면 밖에서 들어와 D, G, O 도로에 자리 잡고, 핀이 떨어져 O 위에 꽂히며 '드라이브 갈 땐' 문구가 나타남"
          style={{ display: 'block', position: 'absolute', left: 0, top: 0 }}
        >
          <g transform="translate(195 400) scale(0.725) translate(-256 -256)">
            <g transform={`translate(256 256) scale(${f.introScale.toFixed(4)}) translate(-256 -256)`}>
              <g opacity={f.roadOpacity}>
                <g fill="none" stroke="#FFFFFF" strokeWidth={32} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M65 202 L73 202 A54 54 0 0 1 73 310 L65 310 Z" />
                  <path d="M274.4 221.3 A54 54 0 1 0 287 256 L251 256" />
                </g>
                <g fill="none" stroke={BG} strokeWidth={3} strokeDasharray="8 9">
                  <path d="M65 202 L73 202 A54 54 0 0 1 73 310 L65 310 Z" />
                  <path d="M274.4 221.3 A54 54 0 1 0 287 256 L251 256" />
                </g>
              </g>
              <g transform={f.carA}>
                <rect x={-5.5} y={-9.5} width={11} height={19} rx={4} fill="#FF7A59" />
                <rect x={-4} y={-5.7} width={8} height={4.2} rx={1.3} fill="#14161A" fillOpacity={0.45} />
              </g>
              <g transform={f.carB}>
                <rect x={-5.5} y={-9.5} width={11} height={19} rx={4} fill="#1E2A44" />
                <rect x={-4} y={-5.7} width={8} height={4.2} rx={1.3} fill="#AACAE6" fillOpacity={0.7} />
              </g>
              <g transform={f.oTf || undefined}>
                <g opacity={f.roadOpacity}>
                  <circle cx={393} cy={256} r={54} fill="none" stroke="#FFFFFF" strokeWidth={32} />
                  <circle cx={393} cy={256} r={54} fill="none" stroke={BG} strokeWidth={3} strokeDasharray="8 9" />
                </g>
                <g transform={f.carC}>
                  <rect x={-5.5} y={-9.5} width={11} height={19} rx={4} fill="#FFB224" />
                  <rect x={-4} y={-5.7} width={8} height={4.2} rx={1.3} fill="#14161A" fillOpacity={0.45} />
                </g>
                <g transform={`translate(0 ${f.pinDy.toFixed(2)})`} opacity={f.pinOpacity}>
                  <path d="M393 182 L366.1 127.2 A30 30 0 1 1 419.9 127.2 Z" fill="#FF7A59" stroke="#FF7A59" strokeWidth={6} strokeLinejoin="round" />
                  <circle cx={393} cy={114} r={11} fill="#FFFFFF" />
                </g>
              </g>
            </g>
          </g>
        </svg>
        <div className="splash-tag" style={{ opacity: f.tagOpacity, transform: `translateY(${f.tagDy.toFixed(2)}px)` }}>
          드라이브 갈 땐
        </div>
      </div>
    </div>
  );
}
