/**
 * 먹깨비 어댑터.
 * 하이픈 API마켓에 먹깨비 상품이 없어서, 사장님 센터에서 내려받은 주문/리뷰 파일(CSV·XLSX)을 읽습니다.
 *
 * 데이터 우선순위
 *  1) MUKKEBI_IMPORT_DIR 에 파일이 있으면 → 그 파일 (source: 'import')
 *  2) 없고 MOCK_MODE=true 이면 → 샘플 데이터 (source: 'mock')
 *  3) 둘 다 아니면 → 빈 데이터 (source: 'empty')
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeliveryAdapter } from '../types.ts';
import type { AccountStatus, AdapterCapabilities, AdSpend, DateRange, MenuItem, Order, Review, SalesRecord, Store } from '../../model.ts';
import { clampRangeToToday, inRange } from '../../util.ts';
import { parseCsv } from './csv.ts';
import { readXlsx } from './xlsx.ts';
import { aggregateMukkebiSales, detectKind, parseMukkebiOrders, parseMukkebiReviews, type MukkebiOrderRow } from './mapping.ts';
import { mukkebiOrdersCsv, mukkebiReviewsCsv } from './mock.ts';

export const MUKKEBI_EXTENSIONS = /\.(csv|tsv|txt|xlsx)$/i;

/** 파일 내용(버퍼) → 행 배열. 확장자로 CSV/XLSX 구분 */
export function readTable(fileName: string, buf: Buffer): string[][] {
  if (/\.xlsx$/i.test(fileName)) return readXlsx(buf);
  if (/\.xls$/i.test(fileName)) throw new Error('구형 .xls 는 지원하지 않습니다. 엑셀에서 .xlsx 또는 CSV(UTF-8)로 저장해 주세요.');
  let text = buf.toString('utf8');
  // 한글 엑셀이 저장한 CSV(CP949/EUC-KR) 대응: 깨진 글자(�)가 보이면 euc-kr 로 다시 해석
  if (text.includes('�')) {
    try { text = new TextDecoder('euc-kr').decode(buf); } catch { /* ICU 미포함 Node 면 그대로 */ }
  }
  return parseCsv(text);
}

export interface ImportedData {
  orders: MukkebiOrderRow[];
  reviews: Review[];
  files: { name: string; kind: string; rows: number; errors: string[] }[];
}

export function loadImportDir(dir: string): ImportedData {
  const result: ImportedData = { orders: [], reviews: [], files: [] };
  if (!existsSync(dir)) return result;
  const seenOrders = new Set<string>();
  const seenReviews = new Set<string>();
  for (const name of readdirSync(dir).filter((n) => MUKKEBI_EXTENSIONS.test(n)).sort()) {
    try {
      const rows = readTable(name, readFileSync(join(dir, name)));
      const { kind } = detectKind(rows);
      if (kind === 'orders') {
        const r = parseMukkebiOrders(rows);
        // 기간이 겹치는 파일을 여러 개 올려도 주문번호로 중복 제거
        for (const o of r.rows) if (!seenOrders.has(o.order.orderId)) { seenOrders.add(o.order.orderId); result.orders.push(o); }
        result.files.push({ name, kind, rows: r.rows.length, errors: r.errors });
      } else if (kind === 'reviews') {
        const r = parseMukkebiReviews(rows);
        for (const v of r.rows) if (!seenReviews.has(v.reviewId)) { seenReviews.add(v.reviewId); result.reviews.push(v); }
        result.files.push({ name, kind, rows: r.rows.length, errors: r.errors });
      } else {
        result.files.push({ name, kind, rows: 0, errors: ['주문/리뷰 파일로 인식하지 못했습니다 (열 이름 확인)'] });
      }
    } catch (e) {
      result.files.push({ name, kind: 'error', rows: 0, errors: [(e as Error).message] });
    }
  }
  return result;
}

export class MukkebiAdapter implements DeliveryAdapter {
  readonly platform = 'mukkebi' as const;
  readonly capabilities: AdapterCapabilities = { orders: true, sales: true, reviews: true, menus: false, ads: false };
  private importDir: string;
  private mock: boolean;

  constructor(opts: { importDir: string; mock: boolean }) {
    this.importDir = opts.importDir;
    this.mock = opts.mock;
  }

  private source(): 'import' | 'mock' | 'empty' {
    if (existsSync(this.importDir) && readdirSync(this.importDir).some((n) => MUKKEBI_EXTENSIONS.test(n))) return 'import';
    return this.mock ? 'mock' : 'empty';
  }

  private load(range: DateRange): { orders: MukkebiOrderRow[]; reviews: Review[] } {
    const src = this.source();
    if (src === 'import') {
      const d = loadImportDir(this.importDir);
      return {
        orders: d.orders.filter((o) => inRange(o.order.orderedAt.slice(0, 10), range)),
        reviews: d.reviews.filter((r) => inRange(r.createdAt.slice(0, 10), range)),
      };
    }
    if (src === 'mock') {
      const r = clampRangeToToday(range);
      if (!r) return { orders: [], reviews: [] };
      return {
        orders: parseMukkebiOrders(parseCsv(mukkebiOrdersCsv(r))).rows,
        reviews: parseMukkebiReviews(parseCsv(mukkebiReviewsCsv(r))).rows,
      };
    }
    return { orders: [], reviews: [] };
  }

  async verifyAccount(): Promise<AccountStatus> {
    const source = this.source();
    const message =
      source === 'import' ? '사장님 센터 내보내기 파일 사용 중'
        : source === 'mock' ? '샘플 데이터 (파일을 올리면 실제 데이터로 바뀝니다)'
          : '가져온 파일이 없습니다';
    return { platform: this.platform, ok: source !== 'empty', source, message };
  }

  async getStores(): Promise<Store[]> {
    return [{ platform: this.platform, storeId: 'MKB-STORE', name: '먹깨비 매장 (파일 가져오기)' }];
  }

  async getOrders(range: DateRange): Promise<Order[]> {
    return this.load(range).orders.map((o) => o.order);
  }

  async getSales(range: DateRange): Promise<SalesRecord[]> {
    return aggregateMukkebiSales(this.load(range).orders);
  }

  async getReviews(range: DateRange): Promise<Review[]> {
    return this.load(range).reviews;
  }

  async getMenus(): Promise<MenuItem[]> {
    return [];
  }

  async getAdSpend(_range: DateRange): Promise<AdSpend[]> {
    return [];
  }
}
