/**
 * 먹깨비 사장님 센터 내보내기(CSV/XLSX) → 공통 모델 매핑.
 *
 * ⚠️ 먹깨비 내보내기 파일의 정확한 열 이름은 공개 자료가 없어 '가정'입니다.
 * 그래서 열 이름마다 여러 별칭(alias)을 받아 주고, 실제 파일을 받아 보면 ORDER_COLUMNS / REVIEW_COLUMNS 에
 * 별칭만 추가하면 됩니다. 필수 열이 없으면 어떤 열이 없는지 알려 주는 오류를 냅니다.
 */
import type { Order, Review, SalesRecord } from '../../model.ts';
import { toWon } from '../../util.ts';
import { clampRating } from '../hyphen/baemin.mapping.ts';

const P = 'mukkebi' as const;

type ColumnSpec<K extends string> = Record<K, { aliases: string[]; required: boolean }>;

export const ORDER_COLUMNS = {
  orderedAt: { aliases: ['주문일시', '주문시간', '주문일자', '주문 일시', '접수일시'], required: true },
  orderId: { aliases: ['주문번호', '주문 번호', '주문ID'], required: true },
  status: { aliases: ['주문상태', '상태', '처리상태'], required: false },
  menu: { aliases: ['주문메뉴', '메뉴', '메뉴명', '주문내역'], required: false },
  amount: { aliases: ['주문금액', '메뉴금액', '상품금액', '음식금액'], required: true },
  tip: { aliases: ['배달팁', '배달료', '고객배달팁'], required: false },
  payMethod: { aliases: ['결제방법', '결제수단', '결제방식'], required: false },
  deliveryType: { aliases: ['배달방식', '수령방법', '주문유형'], required: false },
  commission: { aliases: ['중개수수료', '중개이용료', '주문중개수수료'], required: false },
  paymentFee: { aliases: ['결제수수료', 'PG수수료', '카드수수료'], required: false },
  deliveryCost: { aliases: ['배달비', '배달대행비', '배달비(사장님부담)'], required: false },
  vat: { aliases: ['부가세', '수수료부가세'], required: false },
  payout: { aliases: ['정산예정금액', '정산금액', '입금예정금액', '정산액'], required: false },
  settleDate: { aliases: ['정산예정일', '정산일', '입금예정일'], required: false },
} satisfies ColumnSpec<string>;

export const REVIEW_COLUMNS = {
  createdAt: { aliases: ['작성일시', '작성일', '리뷰일시', '등록일시'], required: true },
  reviewId: { aliases: ['리뷰번호', '리뷰ID', '번호'], required: false },
  rating: { aliases: ['별점', '평점'], required: true },
  menu: { aliases: ['주문메뉴', '메뉴'], required: false },
  content: { aliases: ['리뷰내용', '내용', '리뷰'], required: true },
  author: { aliases: ['작성자', '닉네임'], required: false },
  reply: { aliases: ['사장님댓글', '사장님 댓글', '답글', '댓글'], required: false },
} satisfies ColumnSpec<string>;

const norm = (s: string) => s.replace(/\s+/g, '').replace(/\(원\)$/, '').toLowerCase();

function resolveColumns<K extends string>(header: string[], spec: ColumnSpec<K>): { idx: Record<K, number>; missing: string[] } {
  const h = header.map(norm);
  const idx = {} as Record<K, number>;
  const missing: string[] = [];
  for (const key of Object.keys(spec) as K[]) {
    const i = h.findIndex((col) => spec[key].aliases.some((a) => norm(a) === col));
    idx[key] = i;
    if (i < 0 && spec[key].required) missing.push(spec[key].aliases[0]);
  }
  return { idx, missing };
}

export type MukkebiFileKind = 'orders' | 'reviews' | 'unknown';

/** 헤더 행 위치와 파일 종류 판별 (내보내기 파일 위쪽에 제목·기간 줄이 있어도 헤더를 찾음) */
export function detectKind(rows: string[][]): { kind: MukkebiFileKind; headerRow: number } {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    if (resolveColumns(rows[r], ORDER_COLUMNS).missing.length === 0) return { kind: 'orders', headerRow: r };
    if (resolveColumns(rows[r], REVIEW_COLUMNS).missing.length === 0) return { kind: 'reviews', headerRow: r };
  }
  return { kind: 'unknown', headerRow: -1 };
}

/**
 * 일시 문자열 → KST ISO.
 * 지원: '2026-11-20 18:30(:12)', '2026.11.20 18:30', '2026/11/20 오후 6:30', '20261120183012', 엑셀 날짜 일련번호(46346.77)
 */
export function parseKstDateTime(v: string): string {
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // 엑셀 일련번호 (1899-12-30 기준, 시간대 없는 '현지 시각' = KST 로 간주)
    const ms = Math.round((Number(s) - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 19) + '+09:00';
  }
  const m = s.match(/^(\d{4})[.\-/]?\s*(\d{1,2})[.\-/]?\s*(\d{1,2})\.?\s*(오전|오후|AM|PM)?\s*(\d{1,2})?:?(\d{2})?:?(\d{2})?/i);
  if (!m) throw new Error(`일시를 해석할 수 없습니다: "${s}"`);
  const [, y, mo, d, ampm, hh = '0', mm = '0', ss = '0'] = m;
  let h = Number(hh);
  if (ampm && /오후|pm/i.test(ampm) && h < 12) h += 12;
  if (ampm && /오전|am/i.test(ampm) && h === 12) h = 0;
  const p = (x: number | string) => String(x).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mm)}:${p(ss)}+09:00`;
}

/** 수수료까지 붙은 주문 한 줄 (정산 집계에 사용) */
export interface MukkebiOrderRow {
  order: Order;
  commissionFee: number;
  paymentFee: number;
  deliveryCost: number;
  vat: number;
  payout: number | null;
  settleDate?: string;
}

export interface ParseResult<T> {
  rows: T[];
  errors: string[];
}

const STORE_ID = 'MKB-STORE';

export function parseMukkebiOrders(rows: string[][], storeId = STORE_ID): ParseResult<MukkebiOrderRow> {
  const { kind, headerRow } = detectKind(rows);
  if (kind !== 'orders') {
    const { missing } = resolveColumns(rows[0] ?? [], ORDER_COLUMNS);
    return { rows: [], errors: [`주문 파일 형식이 아닙니다. 없는 열: ${missing.join(', ')}`] };
  }
  const { idx } = resolveColumns(rows[headerRow], ORDER_COLUMNS);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const out: MukkebiOrderRow[] = [];
  const errors: string[] = [];
  rows.slice(headerRow + 1).forEach((r, n) => {
    const line = headerRow + n + 2;
    const orderId = cell(r, idx.orderId);
    if (!orderId || /^(합계|총계|소계)/.test(orderId) || /^(합계|총계)/.test(cell(r, idx.orderedAt))) return;
    try {
      const status = cell(r, idx.status);
      const pay = cell(r, idx.payMethod);
      const type = cell(r, idx.deliveryType);
      const settle = cell(r, idx.settleDate);
      const payoutRaw = cell(r, idx.payout);
      out.push({
        order: {
          platform: P,
          orderId,
          storeId,
          orderedAt: parseKstDateTime(cell(r, idx.orderedAt)),
          status: /취소|거절|환불/.test(status) ? 'cancelled' : 'completed',
          menuSummary: cell(r, idx.menu),
          orderAmount: toWon(cell(r, idx.amount)),
          deliveryTip: toWon(cell(r, idx.tip)),
          paymentMethod: /만나서|현장|현금/.test(pay) ? 'offline' : 'online',
          deliveryType: /포장|픽업/.test(type) ? 'pickup' : 'store',
        },
        commissionFee: toWon(cell(r, idx.commission)),
        paymentFee: toWon(cell(r, idx.paymentFee)),
        deliveryCost: toWon(cell(r, idx.deliveryCost)),
        vat: toWon(cell(r, idx.vat)),
        payout: payoutRaw === '' ? null : toWon(payoutRaw),
        settleDate: settle ? parseKstDateTime(settle).slice(0, 10) : undefined,
      });
    } catch (e) {
      errors.push(`${line}행: ${(e as Error).message}`);
    }
  });
  return { rows: out, errors };
}

/** 주문 단위 → 일별 매출·정산 (취소 주문은 금액에서 제외, 건수만 셈) */
export function aggregateMukkebiSales(rows: MukkebiOrderRow[]): SalesRecord[] {
  const byKey = new Map<string, SalesRecord>();
  for (const r of rows) {
    const date = r.order.orderedAt.slice(0, 10);
    const key = `${r.order.storeId}|${date}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = {
        platform: P, storeId: r.order.storeId, date, settleDate: r.settleDate, orderCount: 0, cancelCount: 0,
        salesAmount: 0, deliveryTip: 0, commissionFee: 0, paymentFee: 0, deliveryCost: 0, vat: 0, otherFees: 0, payoutAmount: 0,
      };
      byKey.set(key, rec);
    }
    if (r.order.status === 'cancelled') {
      rec.cancelCount++;
      continue;
    }
    rec.orderCount++;
    rec.salesAmount += r.order.orderAmount;
    rec.deliveryTip += r.order.deliveryTip;
    rec.commissionFee += r.commissionFee;
    rec.paymentFee += r.paymentFee;
    rec.deliveryCost += r.deliveryCost;
    rec.vat += r.vat;
    // 정산예정금액 열이 없으면 계산식으로 채움
    rec.payoutAmount +=
      r.payout ?? r.order.orderAmount + r.order.deliveryTip - r.commissionFee - r.paymentFee - r.deliveryCost - r.vat;
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function parseMukkebiReviews(rows: string[][], storeId = STORE_ID): ParseResult<Review> {
  const { kind, headerRow } = detectKind(rows);
  if (kind !== 'reviews') return { rows: [], errors: ['리뷰 파일 형식이 아닙니다'] };
  const { idx } = resolveColumns(rows[headerRow], REVIEW_COLUMNS);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const out: Review[] = [];
  const errors: string[] = [];
  rows.slice(headerRow + 1).forEach((r, n) => {
    try {
      const createdAt = parseKstDateTime(cell(r, idx.createdAt));
      const reply = cell(r, idx.reply);
      out.push({
        platform: P,
        reviewId: cell(r, idx.reviewId) || `MKB-R-${createdAt}-${n}`,
        storeId,
        createdAt,
        rating: clampRating(cell(r, idx.rating).replace(/[^0-9.]/g, '')),
        content: cell(r, idx.content),
        authorName: cell(r, idx.author) || undefined,
        menuSummary: cell(r, idx.menu) || undefined,
        reply: reply ? { content: reply } : undefined,
      });
    } catch (e) {
      errors.push(`${headerRow + n + 2}행: ${(e as Error).message}`);
    }
  });
  return { rows: out, errors };
}
