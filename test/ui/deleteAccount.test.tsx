import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// 계정 삭제 (사양서 13.3, 애플 심사 필수): 서버 먼저, 성공해야 폰을 지운다
let phase: 'idle' | 'recording' = 'idle';
vi.mock('../../src/app/recording', async (orig) => {
  const real = await orig<typeof import('../../src/app/recording')>();
  return { ...real, getRecordingState: () => ({ ...real.getRecordingState(), phase }) };
});
const apiFetch = vi.fn(async (..._a: unknown[]) => ({ ok: true, files: 0 }));
vi.mock('../../src/server/api', async (orig) => {
  const real = await orig<typeof import('../../src/server/api')>();
  return { ...real, apiFetch: (...a: unknown[]) => apiFetch(...a) };
});
vi.mock('../../src/app/account', async (orig) => {
  const real = await orig<typeof import('../../src/app/account')>();
  return { ...real, getAuth: () => ({ userId: 'u1', token: 't1' }) };
});

async function seedLocal() {
  localStorage.setItem('gachitayo.token', 't1');
  localStorage.setItem('gachitayo.settings', '{}');
  localStorage.setItem('other.app', 'keep');
  const db = new Dexie('gachitayo');
  db.version(1).stores({ x: 'id' });
  await db.open();
  db.close();
}

describe('계정 삭제 (사양서 13.3)', () => {
  beforeEach(async () => {
    phase = 'idle';
    apiFetch.mockReset().mockResolvedValue({ ok: true, files: 0 });
    localStorage.clear();
    await seedLocal();
  });

  it('기록 남기기(기본): 서버에서 지운 뒤 계정 열쇠만 지우고 폰 기록·설정·즐겨찾기는 남긴다', async () => {
    localStorage.setItem('gachitayo.coursePrefs.v1', '{"prefs":{"favorites":["c1"],"tags":{}}}');
    localStorage.setItem('gachitayo.groupRoom.v1', '{}');
    const { deleteAccount } = await import('../../src/app/deleteAccount');
    const reload = vi.fn();
    await deleteAccount({ wipe: false, reload });
    expect(apiFetch).toHaveBeenCalledWith('DELETE', '/api/me', { token: 't1' });
    expect(await Dexie.exists('gachitayo')).toBe(true);
    expect(localStorage.getItem('gachitayo.token')).toBeNull();
    expect(localStorage.getItem('gachitayo.groupRoom.v1')).toBeNull();
    expect(localStorage.getItem('gachitayo.settings')).not.toBeNull();
    expect(localStorage.getItem('gachitayo.coursePrefs.v1')).not.toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('기록도 지우기: 서버에서 지운 뒤 폰의 기록(IndexedDB)과 디고 설정을 모두 지우고 처음 화면으로', async () => {
    const { deleteAccount } = await import('../../src/app/deleteAccount');
    const reload = vi.fn();
    await deleteAccount({ wipe: true, reload });
    expect(apiFetch).toHaveBeenCalledWith('DELETE', '/api/me', { token: 't1' });
    expect(await Dexie.exists('gachitayo')).toBe(false);
    expect(localStorage.getItem('gachitayo.token')).toBeNull();
    expect(localStorage.getItem('gachitayo.settings')).toBeNull();
    expect(localStorage.getItem('other.app')).toBe('keep');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('서버 삭제가 실패하면(통신 끊김 등) 폰 기록은 그대로 두고 오류를 알린다 (다시 시도할 수 있게)', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { deleteAccount } = await import('../../src/app/deleteAccount');
    const reload = vi.fn();
    await expect(deleteAccount({ wipe: true, reload })).rejects.toThrow();
    expect(await Dexie.exists('gachitayo')).toBe(true);
    expect(localStorage.getItem('gachitayo.token')).toBe('t1');
    expect(reload).not.toHaveBeenCalled();
  });

  it('주행 기록 중이면 서버에 묻지 않고 거절한다', async () => {
    phase = 'recording';
    const { deleteAccount } = await import('../../src/app/deleteAccount');
    await expect(deleteAccount({ wipe: true, reload: vi.fn() })).rejects.toThrow('주행 중에는 계정을 지울 수 없어요');
    expect(apiFetch).not.toHaveBeenCalled();
    expect(await Dexie.exists('gachitayo')).toBe(true);
  });

  it('설정: "계정 지우기" → 확인 창(기록 지우기 체크), 취소면 안 지우고, 지우기를 눌러야 지운다. 실패하면 창 안에 오류', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { DeleteAccountSection } = await import('../../src/ui/screens/SettingsScreen');
    render(<DeleteAccountSection />);
    fireEvent.click(screen.getByRole('button', { name: '계정 지우기' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('닉네임·친구·팀·프로필 사진·공개한 코스가 서버에서 지워지고 되돌릴 수 없어요.');
    expect(screen.getByRole('checkbox', { name: '기록과 내 코스도 이 폰에서 지우기' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '계정 지우기' }));
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('.notice.warn')).not.toBeNull());
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
