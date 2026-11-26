import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, summarize } from '../src/aggregate.ts';
import type { AdSpend, Order, Review, SalesRecord } from '../src/model.ts';

const sale = (p: SalesRecord['platform'], date: string, salesAmount: number, fees: number): SalesRecord => ({
  platform: p, storeId: 'S', date, orderCount: 10, cancelCount: 1, salesAmount, deliveryTip: 10000,
  commissionFee: fees, paymentFee: 0, deliveryCost: 0, vat: Math.round(fees * 0.1), otherFees: 0,
  payoutAmount: salesAmount + 10000 - fees - Math.round(fees * 0.1),
});
const order = (p: Order['platform'], orderedAt: string, status: Order['status'] = 'completed'): Order => ({
  platform: p, orderId: orderedAt + p, storeId: 'S', orderedAt, status, menuSummary: '치킨', orderAmount: 20000, deliveryTip: 0, paymentMethod: 'online',
});
const review = (p: Review['platform'], createdAt: string, rating: number, reply = false): Review => ({
  platform: p, reviewId: createdAt + p, storeId: 'S', createdAt, rating, content: '…', reply: reply ? { content: '감사' } : undefined,
});

test('summarize: 수수료 합계·비중·정산·광고비 비중', () => {
  const s = summarize('baemin', [sale('baemin', '2026-11-01', 190000, 10000)], [{ platform: 'baemin', storeId: 'S', date: '2026-11-01', product: 'x', spend: 19000 }], [], 3);
  assert.equal(s.grossAmount, 200000);
  assert.equal(s.fees.total, 11000);
  assert.equal(s.feeShare, 11000 / 200000);
  assert.equal(s.payout, 189000);
  assert.equal(s.adShare, 0.1);
  assert.equal(s.netAfterAds, 170000);
  assert.equal(s.avgOrderValue, 19000);
  assert.equal(s.avgRating, null);
});

test('buildDashboard: 플랫폼 필터·기간 필터·일별/시간대/요일 집계', () => {
  const range = { from: '2026-11-01', to: '2026-11-02' }; // 11/1 = 일요일
  const data = {
    sales: [sale('baemin', '2026-11-01', 100000, 7800), sale('coupangeats', '2026-11-01', 50000, 3900), sale('mukkebi', '2026-11-02', 30000, 600), sale('baemin', '2026-10-31', 999999, 0)],
    orders: [
      order('baemin', '2026-11-01T12:10:00+09:00'),
      order('baemin', '2026-11-01T12:50:00+09:00'),
      order('coupangeats', '2026-11-01T18:00:00+09:00'),
      order('coupangeats', '2026-11-01T18:30:00+09:00', 'cancelled'),
      order('mukkebi', '2026-11-02T00:30:00+09:00'),
      order('baemin', '2026-11-01T14:59:00Z'), // = 11/1 23:59 KST
    ],
    reviews: [],
    ads: [] as AdSpend[],
  };
  const d = buildDashboard(data, range, { platforms: ['baemin', 'coupangeats'] });
  assert.equal(d.totals.salesAmount, 150000); // 먹깨비 제외, 기간 밖 제외
  assert.deepEqual(d.byPlatform.map((p) => p.platform), ['baemin', 'coupangeats']);
  assert.deepEqual(d.daily[0].sales, { baemin: 100000, coupangeats: 50000 });
  assert.deepEqual(d.daily[0].orders, { baemin: 3, coupangeats: 1 }); // 취소 제외
  assert.deepEqual(d.hourly[12].orders, { baemin: 2 });
  assert.deepEqual(d.hourly[23].orders, { baemin: 1 }); // UTC 일시도 KST 로 변환
  assert.equal(d.weekday[0].label, '일');
  assert.equal(d.weekday[0].orders.baemin, 3);
});

test('buildDashboard: 리뷰 통합 피드 — 최신순, 낮은 별점 표시, 답글 없는 수', () => {
  const range = { from: '2026-11-01', to: '2026-11-30' };
  const reviews = [
    review('baemin', '2026-11-01T10:00:00+09:00', 5, true),
    review('coupangeats', '2026-11-03T10:00:00+09:00', 2),
    review('mukkebi', '2026-11-02T10:00:00+09:00', 3, true),
    review('baemin', '2026-12-01T10:00:00+09:00', 1), // 기간 밖
  ];
  const d = buildDashboard({ sales: [], orders: [], reviews, ads: [] }, range, { platforms: ['baemin', 'coupangeats', 'mukkebi'], lowRatingThreshold: 3 });
  assert.deepEqual(d.reviews.map((r) => r.platform), ['coupangeats', 'mukkebi', 'baemin']);
  assert.deepEqual(d.reviews.map((r) => r.low), [true, true, false]);
  assert.equal(d.totals.lowRatingCount, 2);
  assert.equal(d.totals.unrepliedCount, 1);
  assert.equal(d.totals.avgRating, 3.33);
});

test('buildDashboard: 광고비 vs 매출은 광고 데이터가 있는 플랫폼 매출만 비교', () => {
  const range = { from: '2026-11-01', to: '2026-11-01' };
  const ads: AdSpend[] = [
    { platform: 'baemin', storeId: 'S', date: '2026-11-01', product: '우리가게클릭', spend: 10000, clicks: 40 },
    { platform: 'baemin', storeId: 'S', date: '2026-11-01', product: '울트라콜', spend: 2933 },
  ];
  const d = buildDashboard({ sales: [sale('baemin', '2026-11-01', 100000, 0), sale('coupangeats', '2026-11-01', 70000, 0)], orders: [], reviews: [], ads }, range, { platforms: ['baemin', 'coupangeats'] });
  assert.deepEqual(d.ads.platforms, ['baemin']);
  assert.deepEqual(d.ads.daily, [{ date: '2026-11-01', spend: 12933, sales: 100000 }]);
  assert.deepEqual(d.ads.byProduct[0], { platform: 'baemin', product: '우리가게클릭', spend: 10000, clicks: 40 });
  assert.equal(d.ads.byProduct[1].clicks, null);
});
