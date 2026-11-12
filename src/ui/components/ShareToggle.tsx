// 위치 공유 켜기·끄기 (사양서 8.2, M8). 메인 지도와 주행 준비(사용자 요청 "주행 중에도 위치 공유")에서 쓴다.
// 켤 때는 누구에게 어떻게 보이는지 한 번 알려 준다. 공유는 앱을 다시 열면 꺼져 있다.
import { useState } from 'react';
import { setSharing, useFriends } from '../../app/friends';
import { Overlay } from './Overlay';

export function ShareToggle({ variant }: { variant: 'map' | 'card' }) {
  const fr = useFriends();
  const [ask, setAsk] = useState(false);
  const onClick = () => (fr.sharing ? void setSharing(false) : setAsk(true));
  return (
    <>
      {variant === 'map' ? (
        <button type="button" className="map-share" aria-pressed={fr.sharing} onClick={onClick}>
          <span className="dot" />
          {fr.sharing ? '위치 공유 중' : '위치 공유 꺼짐'}
        </button>
      ) : (
        <section aria-label="위치 공유" className="card card-row">
          <div className="card-col">
            <span className="label">주행 중 위치 공유</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: fr.sharing ? 'var(--friend)' : undefined }}>{fr.sharing ? '공유 중' : '꺼짐'}</span>
            <span className="sub">{fr.sharing ? '친구 지도에 내 위치가 보여요. 친구가 나를 앞 친구로 고르면 간격도 보여요' : '켜면 친구 지도에 내 위치가 보이고, 친구가 나와의 간격을 볼 수 있어요'}</span>
            {fr.error && fr.sharing && <span className="sub" style={{ color: 'var(--warn)' }}>{fr.error}</span>}
          </div>
          <button type="button" className="change-btn" aria-pressed={fr.sharing} onClick={onClick}>
            {fr.sharing ? '끄기' : '켜기'}
          </button>
        </section>
      )}
      {ask && (
        <Overlay>
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
              <h2 id="share-title">위치 공유</h2>
              {fr.friends.length === 0 ? (
                <>
                  <p>아직 친구가 없어요. 설정 → 친구에서 내 친구 코드를 보내거나 친구 코드를 넣어 친구를 추가해 주세요.</p>
                  <div className="modal-actions">
                    <a className="btn btn-primary" href="#/settings" style={{ textAlign: 'center', textDecoration: 'none' }} onClick={() => setAsk(false)}>
                      친구 추가하러 가기
                    </a>
                    <button type="button" className="btn" onClick={() => setAsk(false)}>
                      닫기
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    친구 {fr.friends.length}명에게 내 위치가 보여요. 주행 중에도 계속 보내고, 앱을 화면에 띄워 둔 동안만 보내요. 공유를 끄거나 앱을 닫으면 멈추고, 앱을
                    다시 열면 공유는 꺼져 있어요.
                  </p>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setAsk(false);
                        void setSharing(true);
                      }}
                    >
                      공유 켜기
                    </button>
                    <button type="button" className="btn" onClick={() => setAsk(false)}>
                      취소
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}
