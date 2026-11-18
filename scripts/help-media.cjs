// 도움말 · 기능 알아보기 그림 만들기 (설계 docs/superpowers/specs/2026-11-18-help-design.md) → public/help/
// 실제 앱 화면을 정식 빌드 스위치로 띄워 필요한 부분만 잘라 찍는다. 이름·사진·팀은 예시, 지도는 실제 서버 지도.
//
// 쓰는 법 (개발용, 앱·웹 빌드와 상관없음):
//   1) 정식 스위치로 개발 서버:  VITE_API_URL=https://gachitayo-api.chungyakgo.workers.dev VITE_LOCATION_SHARING=off VITE_LIVE_GAP=off npx vite --port 5194
//   2) 다른 창에서:             node scripts/help-media.cjs        (Playwright·ffmpeg 필요. 회사 망이면 NODE_USE_ENV_PROXY=1)
// 사진(JPEG)은 720 × 450, 움직이는 그림(GIF)은 480 × 300 · 초당 10장 · 약 3.5초 반복 (+ 첫 장을 같은 이름 .jpg 로: 움직임 줄이기용)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'help');
const APP = 'http://localhost:5194/gachitayo/';
const API = 'https://gachitayo-api.chungyakgo.workers.dev';
const VIEW = { width: 440, height: 956 };
/** 카드 그림 비율 8:5 → 화면에서 자르는 높이 */
const CLIP_H = 275;
const A = (c) => c.repeat(32);
const ME = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', C = 'cccccccc-0000-4000-8000-000000000003', D = 'dddddddd-0000-4000-8000-000000000004', E = 'eeeeeeee-0000-4000-8000-000000000005';
const T1 = '11111111-1111-4111-8111-111111111111', ROOM = '99999999-9999-4999-8999-999999999999';
const POS = { lat: 37.5937, lon: 126.9784 };
const DEST = { name: '북악스카이웨이 팔각정', lat: 37.6033, lon: 126.9819 };
const mem = (userId, nickname, avatar) => ({ userId, nickname, avatar });
const team = { id: T1, name: '북악 새벽팀', ownerId: ME, members: [mem(ME, '세영', A('a')), mem(B, '민수', A('b')), mem(C, '지훈', null), mem(D, '서연', A('d'))], gapS: 2, drive: null };
const room = {
  roomId: ROOM, code: '', teamId: T1, teamName: '북악 새벽팀', max: 15, gapS: 2, routeVersion: 0,
  dest: { name: '팔각정', lat: DEST.lat, lon: DEST.lon },
  members: [
    { userId: ME, nickname: '세영', color: 0, order: 1, host: true, avatar: A('a') },
    { userId: B, nickname: '민수', color: 1, order: 2, host: false, avatar: A('b') },
    { userId: D, nickname: '서연', color: 2, order: 3, host: false, avatar: A('d') },
  ],
};
const places = [
  { name: DEST.name, address: '서울 종로구 평창동', lat: DEST.lat, lon: DEST.lon, distanceM: 1200 },
  { name: '팔각정 주차장', address: '서울 종로구 평창동', lat: 37.6035, lon: 126.9822, distanceM: 1250 },
];
/** 예시 경로: 출발 → 팔각정, 산길처럼 굽게 */
const routePts = () => {
  const n = 60;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const lat = POS.lat + (DEST.lat - POS.lat) * k;
    const lon = POS.lon + (DEST.lon - POS.lon) * k + 0.0016 * Math.sin(k * Math.PI * 5) * (1 - k * 0.6);
    out.push([lat, lon]);
  }
  return out;
};
/** 예시 프로필 사진 (사람 사진이 아닌 그림) */
const AVA = { a: ['#7a5a2e', '#7fb6f2'], b: ['#2f6b8a', '#f2a07a'], c: ['#3f8f4a', '#f07ae8'], d: ['#9a3a5a', '#7af0cf'] };
const avatarSvg = (k) => {
  const [bg, fg] = AVA[k] ?? AVA.a;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" fill="${bg}"/><circle cx="80" cy="64" r="34" fill="${fg}"/><rect x="22" y="110" width="116" height="60" rx="10" fill="#1b2638"/></svg>`;
};

async function page(b, o = {}) {
  const c = await b.newContext({ viewport: VIEW, deviceScaleFactor: o.scale ?? 720 / 440, isMobile: true, hasTouch: true, geolocation: { latitude: POS.lat, longitude: POS.lon, accuracy: 5 }, permissions: ['geolocation'] });
  await c.addInitScript((o) => {
    localStorage.setItem('gachitayo.token', 't'.repeat(43));
    localStorage.setItem('gachitayo.userId', o.me);
    localStorage.setItem('gachitayo.nickname', '세영');
    localStorage.setItem('gachitayo.onboarded', '1');
    localStorage.setItem('gachitayo.helpNudge.v1', '1');
    localStorage.setItem('gachitayo.driveZoom.v', '2');
    if (o.settings) localStorage.setItem('gachitayo.settings', JSON.stringify(o.settings));
    if (o.room) localStorage.setItem('gachitayo.groupRoom.v1', JSON.stringify({ roomId: o.room, accepted: 0 }));
  }, { me: ME, room: o.room ? ROOM : null, settings: o.settings ?? null });
  await c.route(/openstreetmap/, (r) => r.abort());
  await c.route(`${API}/**`, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const j = (x) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(x) });
    if (p.startsWith('/map/')) {
      try {
        const r = await fetch(req.url(), { headers: { Origin: 'https://chungyakgo-maker.github.io' } });
        return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' }, body: Buffer.from(await r.arrayBuffer()) });
      } catch {
        return route.abort();
      }
    }
    if (/^\/avatar\//.test(p)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: cors, body: avatarSvg(p[8]) });
    if (p === '/api/me') return j({ userId: ME, nickname: '세영', avatar: A('a'), kakao: true, apple: false });
    if (p === '/api/friends') return j({ code: 'K7QX29MD', friends: [] });
    if (p === '/api/teams') return j({ teams: [team] });
    if (p === `/api/rooms/${ROOM}`) return j(room);
    if (p === '/api/places') return j(places);
    if (p === '/api/route') return j({ distanceM: 2400, durationS: 420, points: routePts(), destName: '북악산로' });
    if (p === '/auth/providers') return j({ kakao: true, apple: true });
    if (p === '/api/courses' || p === '/api/sessions') return j([]);
    return j({});
  });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 160)));
  return pg;
}

const go = async (p, h) => {
  for (let i = 0; i < 20; i++) {
    try {
      await p.goto(`${APP}${h}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`개발 서버(${APP})가 열려 있지 않아요`);
};
const shot = (p, name, y) => p.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 78, clip: { x: 0, y, width: VIEW.width, height: CLIP_H } });
const hideBar = (p) => p.evaluate(() => document.querySelectorAll('.replay-bar').forEach((e) => (e.style.visibility = 'hidden')));

/** 움직이는 그림: 0.1초마다 잘라 찍어 ffmpeg 로 GIF (첫 장은 .jpg 로도) */
async function gif(p, name, y, seconds = 3.5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'help-gif-'));
  const n = Math.round(seconds * 10);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await p.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.png`), clip: { x: 0, y, width: VIEW.width, height: CLIP_H } });
    const wait = t0 + (i + 1) * 100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  const pal = 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '10', '-i', path.join(dir, 'f%03d.png'), '-filter_complex', pal, '-loop', '0', path.join(OUT, `${name}.gif`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, 'f000.png'), '-vf', 'scale=720:-1', '-q:v', '5', path.join(OUT, `${name}.jpg`)]);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 모의주행을 1배속으로 시작 (기본 5배속은 너무 빠르다) */
async function startReplay(p) {
  await go(p, '#/courses');
  await p.waitForTimeout(2500);
  await p.getByText('북악스카이웨이').first().click();
  await p.waitForSelector('text=모의주행 (코스 미리 보기)', { timeout: 20000 });
  await p.waitForTimeout(6000);
  await p.getByText('모의주행 (코스 미리 보기)').click();
  await p.waitForTimeout(2500);
  for (let k = 0; k < 6; k++) {
    const spd = p.locator('button.spd');
    if (/재생 속도 1배/.test((await spd.getAttribute('aria-label')) ?? '')) break;
    await spd.click();
    await p.waitForTimeout(200);
  }
}

/** 북악스카이웨이를 한 번 달린 기록을 폰 저장소에 넣는다 (모의 센서 → 실제 주행 후 처리). 기록 번호를 돌려준다 */
async function seedDrive(p, seed) {
  return p.evaluate(async (seed) => {
    const { simulateCourseDrive } = await import('/gachitayo/src/sim/courseDrive.ts');
    const rec = await import('/gachitayo/src/app/recording.ts');
    const drive = await import('/gachitayo/src/app/drive.ts');
    const courses = await drive.loadCourses();
    const c = courses.find((x) => x.name.includes('북악'));
    const sim = simulateCourseDrive(c, seed);
    const id = crypto.randomUUID();
    const startedAt = Date.now() - sim.durationMs - 60_000;
    await rec.getRepo().create({ id, courseId: c.id, courseVersion: c.version, status: 'finished', startedAt, endedAt: startedAt + sim.durationMs, device: { os: 'iOS', browser: 'app', userAgent: '', standalone: true }, calibration: null, summary: null, imported: true });
    await rec.getRepo().putChunk({ sessionId: id, seq: 0, gps: sim.gps, rawMotion: sim.motion, events: [], channels: {} });
    await rec.refreshSessions();
    await drive.processSession(id);
    return id;
  }, seed);
}

/** 저장된 기록을 1배속으로 다시 재생 (같은 코스의 베스트가 비교 랩이 되어 델타가 보인다) */
async function replaySession(p, id) {
  await p.evaluate(async (id) => {
    const drive = await import('/gachitayo/src/app/drive.ts');
    void drive.startReplay({ kind: 'session', id }, 1);
  }, id);
  await p.waitForSelector('button.spd', { timeout: 60000 });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  try {
    // 기록 · 분석: 주행 요약 (이 기록이 다음 모의주행의 비교 랩이 되어 델타가 보인다)
    let p = await page(b);
    await go(p, '#/');
    await p.waitForTimeout(4000);
    const first = await seedDrive(p, 11);
    const second = await seedDrive(p, 12);
    await go(p, `#/summary/${first}`);
    await p.waitForTimeout(3000);
    await shot(p, 'history', 0);
    // 코스 랩타이머 · 델타 / 커브 표지판(움직이는 그림): 두 번째 기록을 다시 재생 (첫 기록이 비교 랩)
    await replaySession(p, second);
    await p.waitForTimeout(25000);
    await hideBar(p);
    await shot(p, 'lap', 0);
    await gif(p, 'pace', 132);
    await p.close();

    // 바이크 모드 · 기울기 (움직이는 그림): 기울기가 커지는 동안
    p = await page(b, { settings: { vehicle: 'bike', bikeMarker: 'sport', widgets: ['lean', 'pace'] } });
    await startReplay(p);
    const leanNow = async () => {
      const name = await p.getByRole('img', { name: /^기울기 / }).first().getAttribute('aria-label').catch(() => null);
      const m = name && /(왼쪽|오른쪽) (\d+)도 \(/.exec(name);
      return m ? Number(m[2]) : 0;
    };
    for (let i = 0; i < 900 && (await leanNow()) < 6; i++) await p.waitForTimeout(50);
    await hideBar(p);
    await gif(p, 'bike', 132);
    await p.close();

    // 코스 둘러보기: 코스 상세 지도
    p = await page(b);
    await go(p, '#/courses');
    await p.waitForTimeout(2500);
    await p.getByText('북악스카이웨이').first().click();
    await p.waitForSelector('text=모의주행 (코스 미리 보기)', { timeout: 20000 });
    await p.waitForTimeout(6000);
    await shot(p, 'course', 62);

    // 목적지로 주행: 검색 → 경로
    await go(p, '#/destination');
    await p.waitForTimeout(3000);
    await p.locator('input[type="search"], input[type="text"]').first().fill('팔각정');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(2000);
    await p.getByRole('button', { name: new RegExp(DEST.name) }).first().click();
    await p.waitForSelector('text=이 경로로 출발', { timeout: 20000 });
    await p.waitForTimeout(5000);
    await shot(p, 'dest', VIEW.height - CLIP_H);

    // 화면 설정 · 지도: 상단 표시 값 고르기
    await go(p, '#/settings/widgets');
    await p.waitForTimeout(1500);
    await shot(p, 'screen', 75);
    await p.close();

    // 팀 주행: 팀 대기실
    p = await page(b, { room: true });
    await go(p, '#/group');
    await p.waitForSelector('text=주행 순서', { timeout: 30000 });
    await p.waitForTimeout(2500);
    // 예시 서버에는 실시간 연결이 없어 뜨는 "연결하는 중" 줄만 감춘다
    await p.evaluate(() => document.querySelectorAll('[role="status"]').forEach((e) => e.textContent.includes('연결하는 중') && e.remove()));
    await shot(p, 'team', 70);
    await p.close();
  } finally {
    await b.close();
  }
  for (const f of fs.readdirSync(OUT).sort()) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024), 'KB');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
