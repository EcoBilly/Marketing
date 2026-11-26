/** MOCK 전송계층: 샘플 사실을 '쿠팡이츠 원본 응답 모양(가정)'으로 돌려줍니다. */
import { generateOrders, generateReviews, MOCK_MENU, MOCK_STORE, PROFILES } from '../../mock/generator.ts';
import { addDays, eachDay } from '../../util.ts';
import { fromCompactDate, type HyphenTransport } from './client.ts';
import { COUPANG_ENDPOINTS } from './coupangeats.ts';
import type { RawCoupangMenu, RawCoupangOrder, RawCoupangReview, RawCoupangSettlement, RawCoupangStore } from './coupangeats.mapping.ts';

export function createCoupangMockTransport(): HyphenTransport {
  const storeId = 'CPE-' + MOCK_STORE.storeId;
  return async (endpoint, body) => {
    const days =
      body.startDate && body.endDate
        ? eachDay({ from: fromCompactDate(String(body.startDate)), to: fromCompactDate(String(body.endDate)) })
        : [];
    switch (endpoint) {
      case COUPANG_ENDPOINTS.verify:
        return { valid: true };
      case COUPANG_ENDPOINTS.stores: {
        const list: RawCoupangStore[] = [{
          storeId, storeName: MOCK_STORE.name, categoryName: MOCK_STORE.category, address: MOCK_STORE.address,
          phone: MOCK_STORE.phone, commissionRate: PROFILES.coupangeats.commissionRate,
        }];
        return list; // 일부러 data 가 배열인 모양 (listOf 가 둘 다 처리)
      }
      case COUPANG_ENDPOINTS.settlements: {
        const list: RawCoupangSettlement[] = days.map((d) => {
          const os = generateOrders('coupangeats', d);
          const ok = os.filter((o) => o.status === 'completed');
          const sum = (f: (o: (typeof ok)[number]) => number) => ok.reduce((s, o) => s + f(o), 0);
          const sale = sum((o) => o.orderAmount), tip = sum((o) => o.deliveryTip);
          const cms = sum((o) => o.commissionFee), pg = sum((o) => o.paymentFee);
          const dlv = sum((o) => o.deliveryCost), vat = sum((o) => o.vat);
          return {
            storeId, salesDate: d, settlementDate: addDays(d, 7), orderCount: ok.length, cancelCount: os.length - ok.length,
            salesAmount: sale, customerDeliveryFee: tip, commission: cms, pgFee: pg, deliveryCharge: dlv, vat,
            adjustment: 0, settlementAmount: sale + tip - cms - pg - dlv - vat,
          };
        });
        return { list };
      }
      case COUPANG_ENDPOINTS.orders: {
        const list: RawCoupangOrder[] = days.flatMap((d) =>
          generateOrders('coupangeats', d).map((o) => ({
            orderId: o.orderId, storeId, orderDateTime: o.orderedAt.slice(0, 19).replace('T', ' '),
            status: o.status === 'completed' ? 'COMPLETED' : 'CANCELLED',
            items: o.lines.map((l) => ({ name: l.name, quantity: l.qty, price: l.price })),
            totalAmount: o.orderAmount, customerDeliveryFee: o.deliveryTip, paymentType: 'CARD',
            deliveryType: o.deliveryType === 'pickup' ? 'PICKUP' : o.deliveryType === 'store' ? 'STORE' : 'COUPANG',
          })),
        );
        return { list };
      }
      case COUPANG_ENDPOINTS.reviews: {
        const list: RawCoupangReview[] = days.flatMap((d) =>
          generateReviews('coupangeats', d, generateOrders('coupangeats', d)).map((r) => ({
            reviewId: r.reviewId, storeId, reviewDate: r.createdAt.slice(0, 10), reviewTime: r.createdAt.slice(11, 16),
            rating: r.rating, orderItems: r.menuSummary, content: r.content, ownerReply: r.reply?.content,
          })),
        );
        return { list };
      }
      case COUPANG_ENDPOINTS.menus: {
        const list: RawCoupangMenu[] = MOCK_MENU.map((m) => ({
          menuId: 'C' + m.id, storeId, name: m.name, groupName: m.category, salePrice: m.price,
          status: m.soldOut ? 'SOLD_OUT' : 'ON_SALE',
        }));
        return { list };
      }
      default:
        throw new Error(`mock: 알 수 없는 엔드포인트 ${endpoint}`);
    }
  };
}
