/**
 * 의존성 없는 최소 XLSX 리더 — 첫 번째 시트를 문자열 2차원 배열로 읽습니다.
 * (xlsx = ZIP 안의 XML. 공유 문자열·인라인 문자열·숫자 셀 지원, 서식·수식 결과 외 기능은 무시)
 * 구형 .xls(바이너리)는 지원하지 않습니다 → 엑셀에서 'CSV UTF-8' 또는 .xlsx 로 다시 저장하세요.
 */
import { inflateRawSync } from 'node:zlib';

interface ZipEntry { name: string; method: number; compSize: number; localOffset: number }

function readZipEntries(buf: Buffer): ZipEntry[] {
  // End of central directory 레코드를 뒤에서부터 찾기
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('XLSX(ZIP) 형식이 아닙니다');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 중앙 디렉터리 손상');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    entries.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf: Buffer, e: ZipEntry): string {
  const p = e.localOffset;
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return data.toString('utf8');
  if (e.method === 8) return inflateRawSync(data).toString('utf8');
  throw new Error(`지원하지 않는 ZIP 압축 방식: ${e.method}`);
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(buf: Buffer): string[][] {
  const entries = readZipEntries(buf);
  const get = (name: string) => entries.find((e) => e.name === name);
  const shared: string[] = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) for (const m of readEntry(buf, ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const sheetEntry =
    get('xl/worksheets/sheet1.xml') ?? entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!sheetEntry) throw new Error('XLSX 안에서 시트를 찾지 못했습니다');
  const xml = readEntry(buf, sheetEntry);

  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (type === 's' && v != null) val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = textOf(inner);
      else if (v != null) val = decodeXml(v);
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push('');
      row[idx] = val;
    }
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}
