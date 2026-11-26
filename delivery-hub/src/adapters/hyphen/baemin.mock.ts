/**
 * MOCK 전송계층: 생성기의 샘플 사실을 '배민 원본 응답 모양(가정)'으로 바꿔 돌려줍니다.
 * 어댑터는 실제 모드와 똑같이 매핑 코드를 거칩니다.
 */
import { generateBaeminAds, generateOrders, generateReviews, menuSummary, MOCK_MENU, MOCK_STORE, PROFILES, ultraCallPeriods } from '../../mock/generator.ts';
import { eachDay } from '../../util.ts';
import { fromCompactDate, type HyphenTransport } from './client.ts';
import { BAEMIN_ENDPOINTS } from './baemin.ts';
import type { RawBaeminAd, RawBaeminMenu, RawBaeminOrder, RawBaeminReview, RawBaeminSale, RawBaeminSettle, RawBaeminShop } from './baemin.mapping.ts';
import { addDays } from '../../util.ts';

const compact = (d: string) => d.replace(/-/g, '');
const compactDt = (iso: string) => iso.slice(0, 19).replace(/[-T:]/g, '');

export function createBaeminMockTransport(): HyphenTransport {
  const shopNo = MOCK_STORE.storeId;
  return async (endpoint, body) => {
    const range =
      body.stDate && body.edDate
        ? { from: fromCompactDate(String(body.stDate)), to: fromCompactDate(String(body.edDate)) }
        : null;
    const days = range ? eachDay(range) : [];

    switch (endpoint) {
      case BAEMIN_ENDPOINTS.verify:
        return { verifyYn: 'Y', shopCnt: 1 };
      case BAEMIN_ENDPOINTS.shops: {
        const list: RawBaeminShop[] = [{
          shopNo, shopNm: MOCK_STORE.name, ctgryNm: MOCK_STORE.category, addr: MOCK_STORE.address,
          telNo: MOCK_STORE.phone, cmsRate: String(PROFILES.baemin.commissionRate * 100),
        }];
        return { list };
      }
      case BAEMIN_ENDPOINTS.sales: {
        const list: RawBaeminSale[] = days.map((d) => {
          const os = generateOrders('baemin', d);
          const ok = os.filter((o) => o.status === 'completed');
          const on = ok.filter((o) => o.paymentMethod === 'online');
          const off = ok.filter((o) => o.paymentMethod === 'offline');
          const paid = (xs: typeof ok) => xs.reduce((s, o) => s + o.orderAmount + o.deliveryTip, 0);
          return {
            saleDt: compact(d), shopNo, shopNm: MOCK_STORE.name,
            ordCnt: ok.length, ordCnclCnt: os.length - ok.length,
            onlnPayAmt: paid(on), offlnPayAmt: paid(off),
            dlvryTipAmt: ok.reduce((s, o) => s + o.deliveryTip, 0),
          };
        });
        return { list };
      }
      case BAEMIN_ENDPOINTS.settlements: {
        // 최근 2일은 아직 정산 전이라고 가정 → 정산내역에서 빠짐 (매출조회로만 보충되는 경로도 시험)
        const settledUntil = range ? addDays(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), -2) : '';
        const list: RawBaeminSettle[] = days.filter((d) => d <= settledUntil).map((d) => {
          const ok = generateOrders('baemin', d).filter((o) => o.status === 'completed');
          const sum = (f: (o: (typeof ok)[number]) => number) => ok.reduce((s, o) => s + f(o), 0);
          const sale = sum((o) => o.orderAmount), tip = sum((o) => o.deliveryTip);
          const cms = sum((o) => o.commissionFee), pay = sum((o) => o.paymentFee);
          const dlv = sum((o) => o.deliveryCost), vat = sum((o) => o.vat);
          return {
            saleDt: compact(d), stlmDt: compact(addDays(d, 4)), shopNo,
            saleAmt: sale, dlvryTipAmt: tip, cmsFee: cms, payFee: pay, dlvryFee: dlv, vatAmt: vat,
            etcDdctAmt: 0, dpstAmt: sale + tip - cms - pay - dlv - vat,
          };
        });
        return { list };
      }
      case BAEMIN_ENDPOINTS.orders: {
        const list: RawBaeminOrder[] = days.flatMap((d) =>
          generateOrders('baemin', d).map((o) => ({
            ordNo: o.orderId, shopNo, ordDt: compactDt(o.orderedAt),
            ordStatNm: o.status === 'cancelled' ? '주문취소' : '배달완료',
            menuNm: menuSummary(o.lines), ordAmt: o.orderAmount, dlvryTip: o.deliveryTip,
            payTypeNm: o.paymentMethod === 'offline' ? '만나서결제' : '바로결제',
            dlvryTypeNm: o.deliveryType === 'pickup' ? '포장' : o.deliveryType === 'platform' ? '배민배달' : '가게배달',
          })),
        );
        return { list };
      }
      case BAEMIN_ENDPOINTS.reviews: {
        const list: RawBaeminReview[] = days.flatMap((d) =>
          generateReviews('baemin', d, generateOrders('baemin', d)).map((r) => ({
            reviewNo: r.reviewId, shopNo, regDt: compactDt(r.createdAt), starPnt: r.rating, cont: r.content,
            nickNm: r.author, menuNm: r.menuSummary, imgUrlList: r.imageUrls,
            cmtCont: r.reply?.content, cmtRegDt: r.reply ? compactDt(r.reply.createdAt) : undefined,
          })),
        );
        return { list };
      }
      case BAEMIN_ENDPOINTS.menus: {
        const list: RawBaeminMenu[] = MOCK_MENU.map((m) => ({
          menuNo: m.id, shopNo, menuNm: m.name, menuGrpNm: m.category, price: m.price, soldOutYn: m.soldOut ? 'Y' : 'N',
        }));
        return { list };
      }
      case BAEMIN_ENDPOINTS.ads: {
        const list: RawBaeminAd[] = days.flatMap((d) =>
          generateBaeminAds(d).map((a) => ({
            shopNo, adProdNm: a.product, adStDt: compact(a.from), adEdDt: compact(a.to), adAmt: a.spend,
            clickCnt: a.clicks, impCnt: a.impressions,
          })),
        );
        // 기간형 상품(울트라콜, 월 정액)은 조회 기간과 겹치는 달마다 한 줄
        const months = [...new Set(days.map((d) => d.slice(0, 7)))];
        for (const m of months) {
          const u = ultraCallPeriods(m);
          list.push({ shopNo, adProdNm: u.product, adStDt: compact(u.from), adEdDt: compact(u.to), adAmt: u.spend });
        }
        return { list };
      }
      default:
        throw new Error(`mock: 알 수 없는 엔드포인트 ${endpoint}`);
    }
  };
}
