// 어디서 도는가 (사양서 13.3): 같은 코드를 웹(GitHub Pages)과 아이폰 앱(디고, Capacitor)으로 빌드한다.
// 앱 빌드는 `vite build --mode app`. 앱 전용 동작(백그라운드 위치, 공유창, 바깥 내비 등)은 이 값이 참일 때만 켠다.
export function isApp(): boolean {
  return import.meta.env.MODE === 'app';
}

/** 웹앱 공개 주소 (끝에 /). 앱 안에서는 자기 주소가 capacitor://localhost라, 남에게 주는 링크는 늘 이 주소로 */
export const WEB_APP_URL = 'https://chungyakgo-maker.github.io/gachitayo/';
