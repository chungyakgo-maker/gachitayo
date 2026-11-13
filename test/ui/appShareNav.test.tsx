import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// 아이폰 앱 디고 (사양서 13.3): 파일 내보내기는 아이폰 공유창, 내비는 바깥 앱으로
const writeFile = vi.fn(async (_o: unknown) => ({ uri: 'file:///cache/a.csv' }));
const share = vi.fn(async (_o: unknown) => ({}));
const canOpenUrl = vi.fn(async (_o: unknown) => ({ value: true }));
const openUrl = vi.fn(async (_o: unknown) => ({ completed: true }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: (o: unknown) => writeFile(o) }, Directory: { Cache: 'CACHE' } }));
vi.mock('@capacitor/share', () => ({ Share: { share: (o: unknown) => share(o) } }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { canOpenUrl: (o: unknown) => canOpenUrl(o), openUrl: (o: unknown) => openUrl(o) } }));
vi.mock('../../src/platform', () => ({ isApp: () => true }));

describe('아이폰 앱: 공유창과 바깥 내비 (사양서 13.3)', () => {
  beforeEach(() => {
    writeFile.mockClear();
    share.mockReset().mockResolvedValue({});
    canOpenUrl.mockReset().mockResolvedValue({ value: true });
    openUrl.mockClear();
  });

  it('파일은 앱 임시 폴더에 쓰고 아이폰 공유창으로 연다', async () => {
    const { shareOrDownload } = await import('../../src/storage/exportFile');
    const file = new File(['랩,시간\n1,72.4'], '하오고개.csv', { type: 'text/csv' });
    expect(await shareOrDownload(file)).toBe('shared');
    const w = writeFile.mock.calls[0]![0] as { path: string; data: string; directory: string };
    expect(w.path).toBe('하오고개.csv');
    expect(w.directory).toBe('CACHE');
    expect(new TextDecoder().decode(Uint8Array.from(atob(w.data), (c) => c.charCodeAt(0)))).toBe('랩,시간\n1,72.4');
    expect(share).toHaveBeenCalledWith({ title: '하오고개.csv', files: ['file:///cache/a.csv'] });
  });

  it('공유창을 닫으면 cancelled', async () => {
    share.mockRejectedValue(new Error('Share canceled'));
    const { shareOrDownload } = await import('../../src/storage/exportFile');
    expect(await shareOrDownload(new File(['x'], 'a.gpx'))).toBe('cancelled');
  });

  it('내비 앱이 있으면 그 앱으로 (appname은 앱 번들 ID), 없으면 앱스토어', async () => {
    const { openNavApp } = await import('../../src/ui/navLinks');
    const p = { lat: 37.39, lon: 127.01, name: '하오고개 출발' };
    expect(await openNavApp('naver', p)).toBe('opened');
    const url = (openUrl.mock.calls[0]![0] as { url: string }).url;
    expect(url).toMatch(/^nmap:\/\/navigation\?/);
    expect(url).toContain('appname=com.dgo.app');
    canOpenUrl.mockResolvedValue({ value: false });
    expect(await openNavApp('kakao', p)).toBe('store');
    expect((openUrl.mock.calls[1]![0] as { url: string }).url).toBe('https://apps.apple.com/kr/app/id304608425');
  });

  it('코스 상세 "내비로 가기": 앱에서는 버튼을 누르면 바깥 내비 앱으로 연다', async () => {
    const { NavOpen } = await import('../../src/ui/screens/CourseDetailScreen');
    const gate = { lat: 37.39, lon: 127.01, bearingDeg: 90, widthM: 30 };
    const course = { id: 'c', name: '하오고개', kind: 'point_to_point', source: 'gpx', origin: { lat: 37.39, lon: 127.01 }, startGate: gate, finishGate: { ...gate, lat: 37.4 }, centerline: null, lengthM: null, sectorBoundsM: null, version: 1 } as const;
    render(<NavOpen course={course} />);
    const btn = screen.getByRole('button', { name: '출발점까지 네이버 지도로 길안내' });
    fireEvent.click(btn);
    await waitFor(() => expect(openUrl).toHaveBeenCalled());
    expect((openUrl.mock.calls[0]![0] as { url: string }).url).toMatch(/^nmap:\/\/navigation\?dlat=37.39/);
  });
});
