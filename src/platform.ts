// 어디서 도는가 (사양서 13.3): 같은 코드를 웹(GitHub Pages)과 아이폰 앱(디고, Capacitor)으로 빌드한다.
// 앱 빌드는 `vite build --mode app`. 앱 전용 동작(백그라운드 위치, 공유창, 바깥 내비 등)은 이 값이 참일 때만 켠다.
export function isApp(): boolean {
  return import.meta.env.MODE === 'app';
}

/** 웹앱 공개 주소 (끝에 /). 앱 안에서는 자기 주소가 capacitor://localhost라, 남에게 주는 링크는 늘 이 주소로 */
export const WEB_APP_URL = 'https://chungyakgo-maker.github.io/gachitayo/';

/** 아이폰 기능을 부를 때 기다림 한도 (메리고에서 겪은 일: 앱에 없는 기능을 부르면 Capacitor는 오류 없이 대답을 안 해서 화면이 영원히 기다렸다).
 *  사람이 고르는 창(공유·로그인)에는 쓰지 않는다. 한도를 넘으면 오류로 끝낸다 */
export function nativeCall<T>(p: Promise<T>, ms = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('아이폰 기능이 대답하지 않아요')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
