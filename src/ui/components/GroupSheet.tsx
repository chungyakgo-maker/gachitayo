// 그룹 주행 시작 창 (시안 "시작 창"): 방 만들기 / 방 코드로 들어가기. 카톡으로 받은 초대 링크는 바로 들어온다
import { useState, type FormEvent } from 'react';
import { useAccount } from '../../app/account';
import { createGroupRoom, groupErrorText, joinGroupRoom } from '../../app/group';
import { Sheet } from './Sheet';

export function GroupSheet({ onClose }: { onClose: () => void }) {
  const acc = useAccount();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = acc.status === 'ready';
  const run = (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    f().then(
      () => {
        onClose();
        window.location.hash = '#/group';
      },
      (e: unknown) => {
        setError(groupErrorText(e));
        setBusy(false);
      },
    );
  };
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) run(() => joinGroupRoom(code));
  };
  return (
    <Sheet title="그룹 주행" onClose={onClose}>
      {!ready && <span className="notice warn">계정이 있어야 그룹 주행을 할 수 있어요. 통신을 확인하고 앱을 다시 열어 주세요</span>}
      <button type="button" className="primary-btn" disabled={!ready || busy} onClick={() => run(createGroupRoom)}>
        방 만들기
      </button>
      <span className="label" style={{ marginTop: 6 }}>
        방 코드로 들어가기
      </span>
      <form className="group-row" onSubmit={onJoin}>
        <input
          className="text-input group-code-input"
          inputMode="numeric"
          autoComplete="off"
          aria-label="방 코드 6자리"
          placeholder="6자리 숫자"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button type="submit" className="btn" style={{ minWidth: 88 }} disabled={!ready || busy || code.length !== 6}>
          입장
        </button>
      </form>
      {error && (
        <span className="notice warn" role="alert">
          {error}
        </span>
      )}
      <span className="sub">카톡으로 받은 초대 링크를 누르면 바로 들어와요</span>
    </Sheet>
  );
}
