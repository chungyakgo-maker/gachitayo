interface UpdateBannerProps {
  visible: boolean;
  onUpdate: () => void;
}

/** 새 버전 안내. 주행 중 자동 새로고침을 막기 위해 사용자가 눌러야만 적용한다. */
export function UpdateBanner({ visible, onUpdate }: UpdateBannerProps) {
  if (!visible) return null;
  return (
    <div className="update-banner" role="status">
      <span>새 버전이 있습니다</span>
      <button type="button" onClick={onUpdate}>
        업데이트
      </button>
    </div>
  );
}
