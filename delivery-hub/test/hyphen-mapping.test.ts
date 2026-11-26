import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapBaeminAds, mapBaeminOrder, mapBaeminReview, mapBaeminSales, mapBaeminShop } from '../src/adapters/hyphen/baemin.mapping.ts';
import { mapCoupangOrder, mapCoupangReview, mapCoupangSettlement } from '../src/adapters/hyphen/coupangeats.mapping.ts';
import { HyphenError, unwrapEnvelope } from '../src/adapters/hyphen/client.ts';

test('배민: 정산내역 + 매출조회를 매출일 기준으로 합치고, 정산 전 날은 매출조회로 채운다', () => {
  const settles = [{
    saleDt: '20261101', stlmDt: '20261105', shopNo: 'S1', saleAmt: '100,000', dlvryTipAmt: 6000,
    cmsFee: 7800, payFee: 3180, dlvryFee: 6200, vatAmt: 1720, etcDdctAmt: 0, dpstAmt: 87100,
  }];
  const sales = [
    { saleDt: '20261101', shopNo: 'S1', ordCnt: 4, ordCnclCnt: 1, onlnPayAmt: 106000, offlnPayAmt: 0, dlvryTipAmt: 6000 },
    { saleDt: '20261102', shopNo: 'S1', ordCnt: 2, ordCnclCnt: 0, onlnPayAmt: 30000, offlnPayAmt: 22000, dlvryTipAmt: 2000 },
  ];
  const out = mapBaeminSales(sales, settles);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    platform: 'baemin', storeId: 'S1', date: '2026-11-01', settleDate: '2026-11-05', orderCount: 4, cancelCount: 1,
    salesAmount: 100000, deliveryTip: 6000, commissionFee: 7800, paymentFee: 3180, deliveryCost: 6200, vat: 1720,
    otherFees: 0, payoutAmount: 87100,
  });
  // 정산 전: 결제금액(팁 포함) − 팁 = 음식 매출, 수수료 0
  assert.equal(out[1].salesAmount, 50000);
  assert.equal(out[1].deliveryTip, 2000);
  assert.equal(out[1].commissionFee, 0);
  assert.equal(out[1].payoutAmount, 52000);
});

test('배민: 주문 상태·결제·배달방식 문자열 해석', () => {
  const base = { ordNo: 'O1', shopNo: 'S1', ordDt: '20261101183005', menuNm: '양념치킨', ordAmt: '21000', dlvryTip: '3000' };
  const a = mapBaeminOrder({ ...base, ordStatNm: '배달완료', payTypeNm: '바로결제', dlvryTypeNm: '배민배달' });
  assert.equal(a.orderedAt, '2026-11-01T18:30:05+09:00');
  assert.equal(a.status, 'completed');
  assert.equal(a.paymentMethod, 'online');
  assert.equal(a.deliveryType, 'platform');
  assert.equal(a.orderAmount, 21000);
  const b = mapBaeminOrder({ ...base, ordStatNm: '주문취소', payTypeNm: '만나서결제', dlvryTypeNm: '포장' });
  assert.equal(b.status, 'cancelled');
  assert.equal(b.paymentMethod, 'offline');
  assert.equal(b.deliveryType, 'pickup');
});

test('배민: 리뷰 댓글·이미지, 가게 수수료율(%) 변환', () => {
  const r = mapBaeminReview({
    reviewNo: 'R1', shopNo: 'S1', regDt: '20261101200000', starPnt: '2', cont: '식었어요',
    imgUrlList: ['https://x/1.jpg'], cmtCont: '죄송합니다', cmtRegDt: '20261101230000',
  });
  assert.equal(r.rating, 2);
  assert.deepEqual(r.reply, { content: '죄송합니다', createdAt: '2026-11-01T23:00:00+09:00' });
  assert.deepEqual(r.imageUrls, ['https://x/1.jpg']);
  assert.equal(mapBaeminReview({ reviewNo: 'R2', shopNo: 'S1', regDt: '20261101200000', starPnt: 9, cont: '' }).rating, 5);
  assert.equal(mapBaeminShop({ shopNo: 'S1', shopNm: '가게', cmsRate: '7.8' }).commissionRate, 0.078);
});

test('배민 광고: 월 정액 광고비를 일 단위로 나누고 합계는 원금과 같다', () => {
  const rows = [{ shopNo: 'S1', adProdNm: '울트라콜', adStDt: '20261101', adEdDt: '20261130', adAmt: 88000 }];
  const whole = mapBaeminAds(rows, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(whole.length, 30);
  assert.equal(whole.reduce((s, a) => s + a.spend, 0), 88000);
  const part = mapBaeminAds(rows, { from: '2026-11-10', to: '2026-11-12' });
  assert.deepEqual(part.map((a) => a.date), ['2026-11-10', '2026-11-11', '2026-11-12']);
  assert.equal(part[0].spend, 2933);
  // 일 단위 광고는 클릭 수 유지
  const cpc = mapBaeminAds([{ shopNo: 'S1', adProdNm: '우리가게클릭', adStDt: '20261101', adEdDt: '20261101', adAmt: 9000, clickCnt: '30' }], { from: '2026-11-01', to: '2026-11-01' });
  assert.equal(cpc[0].clicks, 30);
});

test('쿠팡이츠: 정산 조정(음수)은 기타차감, 리뷰 날짜+시간 합치기, 주문 품목 요약', () => {
  const s = mapCoupangSettlement({
    storeId: 'C1', salesDate: '2026-11-01', settlementDate: '2026-11-08', orderCount: 3, cancelCount: 0, salesAmount: 60000,
    customerDeliveryFee: 3000, commission: 4680, pgFee: 1890, deliveryCharge: 8700, vat: 1530, adjustment: -1000, settlementAmount: 45200,
  });
  assert.equal(s.platform, 'coupangeats');
  assert.equal(s.otherFees, 1000);
  assert.equal(s.settleDate, '2026-11-08');
  const r = mapCoupangReview({ reviewId: 'R', storeId: 'C1', reviewDate: '2026-11-01', reviewTime: '19:05', rating: 4, orderItems: '반반치킨', content: '굿' });
  assert.equal(r.createdAt, '2026-11-01T19:05:00+09:00');
  const o = mapCoupangOrder({
    orderId: 'O', storeId: 'C1', orderDateTime: '2026-11-01 12:01:02', status: 'REJECTED', totalAmount: 26000, customerDeliveryFee: 0,
    items: [{ name: '후라이드치킨', quantity: 2, price: 20000 }, { name: '콜라 1.25L', quantity: 1, price: 2500 }],
  });
  assert.equal(o.status, 'cancelled');
  assert.equal(o.menuSummary, '후라이드치킨 x2 외 1건');
});

test('하이픈 응답 봉투: errYn=Y 면 오류', () => {
  assert.deepEqual(unwrapEnvelope({ common: { errYn: 'N' }, data: { list: [1] } }), { list: [1] });
  assert.throws(() => unwrapEnvelope({ common: { errYn: 'Y', errCd: 'LOGIN', errMsg: '로그인 실패' } }), HyphenError);
});
