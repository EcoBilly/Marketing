/** 먹깨비 MOCK: 샘플 사실을 '먹깨비 사장님 센터 내보내기 CSV(가정)' 텍스트로 만듭니다. */
import { generateOrders, generateReviews, menuSummary } from '../../mock/generator.ts';
import type { DateRange } from '../../model.ts';
import { addDays, eachDay } from '../../util.ts';
import { toCsv } from './csv.ts';

export const MUKKEBI_ORDER_HEADER = [
  '주문일시', '주문번호', '주문상태', '주문메뉴', '주문금액', '배달팁', '결제방법', '배달방식',
  '중개수수료', '결제수수료', '배달비', '부가세', '정산예정금액', '정산예정일',
];
export const MUKKEBI_REVIEW_HEADER = ['작성일시', '리뷰번호', '별점', '주문메뉴', '리뷰내용', '작성자', '사장님댓글'];

const fmt = (iso: string) => iso.slice(0, 19).replace('T', ' ');

export function mukkebiOrdersCsv(range: DateRange): string {
  const rows: (string | number)[][] = [MUKKEBI_ORDER_HEADER];
  for (const d of eachDay(range)) {
    for (const o of generateOrders('mukkebi', d)) {
      const cancelled = o.status === 'cancelled';
      const payout = cancelled ? 0 : o.orderAmount + o.deliveryTip - o.commissionFee - o.paymentFee - o.deliveryCost - o.vat;
      rows.push([
        fmt(o.orderedAt), o.orderId, cancelled ? '주문취소' : '배달완료', menuSummary(o.lines),
        o.orderAmount.toLocaleString('ko-KR'), o.deliveryTip, o.paymentMethod === 'offline' ? '만나서결제' : '앱결제',
        o.deliveryType === 'pickup' ? '포장' : '가게배달', o.commissionFee, o.paymentFee, o.deliveryCost, o.vat,
        payout, addDays(d, 5),
      ]);
    }
  }
  return toCsv(rows);
}

export function mukkebiReviewsCsv(range: DateRange): string {
  const rows: (string | number)[][] = [MUKKEBI_REVIEW_HEADER];
  for (const d of eachDay(range)) {
    for (const r of generateReviews('mukkebi', d, generateOrders('mukkebi', d))) {
      rows.push([fmt(r.createdAt), r.reviewId, r.rating, r.menuSummary, r.content, r.author, r.reply?.content ?? '']);
    }
  }
  return toCsv(rows);
}
