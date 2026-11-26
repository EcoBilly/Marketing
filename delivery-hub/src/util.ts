/** 날짜·숫자 공용 유틸 (모든 날짜 계산은 한국시간 KST 기준) */
import type { DateRange } from './model.ts';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 지금(또는 주어진 시각)의 KST 날짜 'YYYY-MM-DD' */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(date + 'T00:00:00Z') + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** from~to 사이 모든 날짜 (양 끝 포함) */
export function eachDay(range: DateRange): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);
}

/** 0=일 … 6=토 */
export function weekday(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** ISO 일시(오프셋 포함)를 KST 날짜와 시(0~23)로 */
export function kstParts(iso: string): { date: string; hour: number } {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`잘못된 일시: ${iso}`);
  const k = new Date(t + KST_OFFSET_MS).toISOString();
  return { date: k.slice(0, 10), hour: Number(k.slice(11, 13)) };
}

/** KST 날짜·시각 조각으로 ISO(+09:00) 문자열 만들기 */
export function kstIso(date: string, hh: number, mm = 0, ss = 0): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date}T${p(hh)}:${p(mm)}:${p(ss)}+09:00`;
}

export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

export function clampRangeToToday(range: DateRange, today = todayKst()): DateRange | null {
  const to = range.to > today ? today : range.to;
  return range.from > to ? null : { from: range.from, to };
}

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** "25,000원", "1.2만"(X) 같은 값을 정수 원으로. 해석 불가면 0 */
export function toWon(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  if (v == null) return 0;
  const s = String(v).replace(/[,\s원₩]/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function toInt(v: unknown): number {
  return toWon(v);
}

/** 문자열 시드 기반 결정적 난수 (같은 날짜·플랫폼이면 항상 같은 샘플 데이터) */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
