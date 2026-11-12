// 거치 팁 (사양서 8.3, 8.8): 주행 준비와 설정에서 같이 쓴다
export function MountTips() {
  return (
    <ul className="tips">
      <li>하늘이 잘 보이는 앞유리 쪽에 거치하세요.</li>
      <li>금속 성분 썬팅은 GPS를 약하게 합니다.</li>
      <li>L1+L5 이중 주파수 GPS를 지원하는 폰이 더 정확합니다.</li>
      <li>주행 중에 거치대를 움직이면 다시 보정합니다.</li>
    </ul>
  );
}
