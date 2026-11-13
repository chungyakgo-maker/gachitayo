// 어디서 도는가 (사양서 13.3): 같은 코드를 웹(GitHub Pages)과 아이폰 앱(디고, Capacitor)으로 빌드한다.
// 앱 빌드는 `vite build --mode app`. 앱 전용 동작(백그라운드 위치, 공유창, 바깥 내비 등)은 이 값이 참일 때만 켠다.
export function isApp(): boolean {
  return import.meta.env.MODE === 'app';
}
