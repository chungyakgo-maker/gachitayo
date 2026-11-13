// 카카오 로그인 버튼 (카카오 디자인 가이드: 노랑 #FEE500, 검정 말풍선, 글자 검정 85%)
export function KakaoButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="kakao-btn" disabled={disabled} onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#000" d="M12 3C6.48 3 2 6.48 2 10.78c0 2.77 1.86 5.2 4.66 6.58l-1.02 3.73c-.09.33.29.6.58.41l4.45-2.95c.44.04.88.07 1.33.07 5.52 0 10-3.48 10-7.84S17.52 3 12 3z" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
