// GPX 내보내기 (사양서 8.7): 코스는 중심선, 주행 기록은 원본 GPS 점(시간·고도, 속도는 가민 확장).
import { GPX_CREATOR } from './course';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const HEAD = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<gpx version="1.1" creator="${GPX_CREATOR}" xmlns="http://www.topografix.com/GPX/1/1" ` +
  `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2">\n` +
  `  <metadata><name>${esc(name)}</name></metadata>\n` +
  `  <trk>\n    <name>${esc(name)}</name>\n    <trkseg>\n`;
const TAIL = `    </trkseg>\n  </trk>\n</gpx>\n`;

export function courseToGpx(course: {
  name: string;
  centerline: Array<[number, number]> | null;
  startGate: { lat: number; lon: number };
  finishGate: { lat: number; lon: number };
}): string {
  const pts = course.centerline ?? [
    [course.startGate.lat, course.startGate.lon],
    [course.finishGate.lat, course.finishGate.lon],
  ];
  return HEAD(course.name) + pts.map(([lat, lon]) => `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"/>\n`).join('') + TAIL;
}

export function sessionToGpx(opts: {
  name: string;
  gps: Array<{ tFix: number; lat: number; lon: number; alt: number | null; speed: number | null }>;
}): string {
  const body = opts.gps
    .map((g) => {
      const ele = g.alt === null ? '' : `<ele>${g.alt.toFixed(2)}</ele>`;
      const time = `<time>${new Date(g.tFix).toISOString()}</time>`;
      const speed =
        g.speed === null
          ? ''
          : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${g.speed.toFixed(2)}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>`;
      return `      <trkpt lat="${g.lat.toFixed(7)}" lon="${g.lon.toFixed(7)}">${ele}${time}${speed}</trkpt>\n`;
    })
    .join('');
  return HEAD(opts.name) + body + TAIL;
}
