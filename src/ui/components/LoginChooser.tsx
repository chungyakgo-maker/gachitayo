// 로그인 고르기 (메리고와 같게, 2026-11-17): 아이폰 앱은 "로그인" 단추 하나 → [카카오로 로그인] [Apple로 로그인]을 고르는 창.
// (노란 카카오 단추를 눌렀는데 애플이 나오면 어색해서.) 웹은 카카오만 있으니 카카오 단추를 그대로 둔다
import { useState } from 'react';
import { AppleButton } from './AppleButton';
import { KakaoButton } from './KakaoButton';
import { Sheet } from './Sheet';

export function LoginChooser({
  kakao,
  apple,
  disabled,
  kakaoLabel,
  onKakao,
  onApple,
}: {
  kakao: boolean;
  apple: boolean;
  disabled?: boolean;
  /** 카카오만 있을 때(웹) 단추 글자 */
  kakaoLabel: string;
  onKakao: () => void;
  onApple: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!apple) return kakao ? <KakaoButton label={kakaoLabel} disabled={disabled} onClick={onKakao} /> : null;
  return (
    <>
      <button type="button" className="login-btn" disabled={disabled} onClick={() => setOpen(true)}>
        로그인
      </button>
      {open && (
        <Sheet title="로그인 방법을 골라 주세요" onClose={() => setOpen(false)}>
          {kakao && (
            <KakaoButton
              label="카카오로 로그인"
              onClick={() => {
                setOpen(false);
                onKakao();
              }}
            />
          )}
          <AppleButton
            label="Apple로 로그인"
            onClick={() => {
              setOpen(false);
              onApple();
            }}
          />
          <span className="sub" style={{ textAlign: 'center' }}>
            처음이면 새 계정이 만들어지고, 다음에 같은 방법으로 로그인하면 기록이 돌아와요
          </span>
        </Sheet>
      )}
    </>
  );
}
