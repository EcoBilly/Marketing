/**
 * 배달의민족(하이픈 상품 seq=183) 원본 응답 → 공통 모델 매핑.
 *
 * ⚠️ 아래 원본 필드명(shopNo, saleDt …)은 모두 '가정'입니다.
 * 계약 후 받은 연동 가이드의 실제 필드명으로 Raw* 타입과 map* 함수만 고치면 되고,
 * 나머지 코드(어댑터·집계·대시보드)는 손댈 필요가 없게 분리해 두었습니다.
 */
import type { AdSpend, DateRange, MenuItem, Order, Review, SalesRecord, Store } from '../../model.ts';
import { toInt, toWon } from '../../util.ts';
import { prorateAd } from '../prorate.ts';
import { fromCompactDate, fromCompactDateTime } from './client.ts';

const P = 'baemin' as const;

/** 내 가게 / 음식점정보 — TODO: 실제 필드명 확인 */
export interface RawBaeminShop {
  shopNo: string;
  shopNm: string;
  ctgryNm?: string;
  addr?: string;
  telNo?: string;
  /** 수수료율(%) 문자열, 예: "7.8" */
  cmsRate?: string;
}

/** 매출조회 (일별) — 주문건수 성공/취소, 결제금액 온라인/현장, 배달료 … */
export interface RawBaeminSale {
  saleDt: string; // YYYYMMDD
  shopNo: string;
  shopNm?: string;
  ordCnt: number | string; // 성공 주문건수
  ordCnclCnt: number | string; // 취소 주문건수
  onlnPayAmt: number | string; // 온라인(앱) 결제금액 — 배달팁 포함 가정
  offlnPayAmt: number | string; // 현장(만나서) 결제금액 — 배달팁 포함 가정
  dlvryTipAmt: number | string; // 배달료(고객 배달팁)
}

/** 정산내역 — 정산일, 정산금액, 매출액, 입금금액, 배달팁, 이용료, 수수료 */
export interface RawBaeminSettle {
  saleDt: string; // 매출일 YYYYMMDD
  stlmDt?: string; // 정산(입금)일
  shopNo: string;
  saleAmt: number | string; // 매출액(음식)
  dlvryTipAmt: number | string; // 배달팁
  cmsFee: number | string; // 중개이용료
  payFee: number | string; // 결제수수료
  dlvryFee: number | string; // 배민1 배달비(사장님 부담)
  vatAmt: number | string; // 부가세
  etcDdctAmt?: number | string; // 기타 차감(광고비 등)
  dpstAmt: number | string; // 입금금액
}

/** 주문내역 */
export interface RawBaeminOrder {
  ordNo: string;
  shopNo: string;
  ordDt: string; // YYYYMMDDHHmmss
  ordStatNm: string; // 배달완료 / 주문취소 …
  menuNm: string;
  ordAmt: number | string; // 음식 금액
  dlvryTip: number | string;
  payTypeNm: string; // 바로결제 / 만나서결제
  dlvryTypeNm?: string; // 가게배달 / 배민배달(배민1) / 포장
}

/** 리뷰 — 별점, 내용, 이미지, 댓글 */
export interface RawBaeminReview {
  reviewNo: string;
  shopNo: string;
  regDt: string; // YYYYMMDDHHmmss
  starPnt: number | string;
  cont: string;
  nickNm?: string;
  menuNm?: string;
  imgUrlList?: string[];
  cmtCont?: string; // 사장님 댓글
  cmtRegDt?: string;
}

export interface RawBaeminMenu {
  menuNo: string;
  shopNo: string;
  menuNm: string;
  menuGrpNm?: string;
  price: number | string;
  soldOutYn?: 'Y' | 'N';
}

/** 광고관리 — 광고기간, 광고비 (기간 단위로 온다고 가정 → 일 단위로 나눔) */
export interface RawBaeminAd {
  shopNo: string;
  adProdNm: string;
  adStDt: string; // YYYYMMDD
  adEdDt: string; // YYYYMMDD
  adAmt: number | string;
  clickCnt?: number | string;
  impCnt?: number | string;
}

export function mapBaeminShop(r: RawBaeminShop): Store {
  const rate = r.cmsRate != null && r.cmsRate !== '' ? Number(r.cmsRate) / 100 : undefined;
  return {
    platform: P,
    storeId: String(r.shopNo),
    name: r.shopNm,
    category: r.ctgryNm,
    address: r.addr,
    phone: r.telNo,
    commissionRate: rate != null && Number.isFinite(rate) ? rate : undefined,
  };
}

/**
 * 매출조회 + 정산내역을 (매장, 매출일) 기준으로 합칩니다.
 * 정산내역이 금액·수수료의 기준이고, 매출조회는 주문/취소 건수를 보충합니다.
 * 정산내역이 아직 없는 날(최근 며칠)은 매출조회만으로 만들고 수수료는 0, 입금액은 결제금액으로 둡니다.
 */
export function mapBaeminSales(sales: RawBaeminSale[], settles: RawBaeminSettle[]): SalesRecord[] {
  const byKey = new Map<string, SalesRecord>();
  const key = (shop: string, date: string) => `${shop}|${date}`;

  for (const s of settles) {
    const date = fromCompactDate(s.saleDt);
    const rec: SalesRecord = {
      platform: P,
      storeId: String(s.shopNo),
      date,
      settleDate: s.stlmDt ? fromCompactDate(s.stlmDt) : undefined,
      orderCount: 0,
      cancelCount: 0,
      salesAmount: toWon(s.saleAmt),
      deliveryTip: toWon(s.dlvryTipAmt),
      commissionFee: toWon(s.cmsFee),
      paymentFee: toWon(s.payFee),
      deliveryCost: toWon(s.dlvryFee),
      vat: toWon(s.vatAmt),
      otherFees: toWon(s.etcDdctAmt),
      payoutAmount: toWon(s.dpstAmt),
    };
    const k = key(rec.storeId, date);
    const prev = byKey.get(k);
    byKey.set(k, prev ? sumSales(prev, rec) : rec);
  }

  for (const s of sales) {
    const date = fromCompactDate(s.saleDt);
    const k = key(String(s.shopNo), date);
    const rec = byKey.get(k);
    if (rec) {
      rec.orderCount += toInt(s.ordCnt);
      rec.cancelCount += toInt(s.ordCnclCnt);
    } else {
      const tip = toWon(s.dlvryTipAmt);
      const paid = toWon(s.onlnPayAmt) + toWon(s.offlnPayAmt);
      byKey.set(k, {
        platform: P,
        storeId: String(s.shopNo),
        date,
        orderCount: toInt(s.ordCnt),
        cancelCount: toInt(s.ordCnclCnt),
        salesAmount: paid - tip,
        deliveryTip: tip,
        commissionFee: 0,
        paymentFee: 0,
        deliveryCost: 0,
        vat: 0,
        otherFees: 0,
        payoutAmount: paid, // TODO: 정산 전 금액이라 수수료 미반영 — 대시보드에 '정산 전' 표기 고려
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sumSales(a: SalesRecord, b: SalesRecord): SalesRecord {
  return {
    ...a,
    orderCount: a.orderCount + b.orderCount,
    cancelCount: a.cancelCount + b.cancelCount,
    salesAmount: a.salesAmount + b.salesAmount,
    deliveryTip: a.deliveryTip + b.deliveryTip,
    commissionFee: a.commissionFee + b.commissionFee,
    paymentFee: a.paymentFee + b.paymentFee,
    deliveryCost: a.deliveryCost + b.deliveryCost,
    vat: a.vat + b.vat,
    otherFees: a.otherFees + b.otherFees,
    payoutAmount: a.payoutAmount + b.payoutAmount,
  };
}

// TODO: 실제 주문상태 값 목록 확인 (배달완료·주문취소 외에 '거절', '배달중' 등)
const CANCEL_WORDS = ['취소', '거절', '거부'];

export function mapBaeminOrder(r: RawBaeminOrder): Order {
  const type = r.dlvryTypeNm ?? '';
  return {
    platform: P,
    orderId: String(r.ordNo),
    storeId: String(r.shopNo),
    orderedAt: fromCompactDateTime(r.ordDt),
    status: CANCEL_WORDS.some((w) => r.ordStatNm.includes(w)) ? 'cancelled' : 'completed',
    menuSummary: r.menuNm,
    orderAmount: toWon(r.ordAmt),
    deliveryTip: toWon(r.dlvryTip),
    paymentMethod: r.payTypeNm.includes('만나서') ? 'offline' : 'online',
    deliveryType: type.includes('포장') ? 'pickup' : /배민1|배민배달|한집|알뜰/.test(type) ? 'platform' : 'store',
  };
}

export function mapBaeminReview(r: RawBaeminReview): Review {
  return {
    platform: P,
    reviewId: String(r.reviewNo),
    storeId: String(r.shopNo),
    createdAt: fromCompactDateTime(r.regDt),
    rating: clampRating(r.starPnt),
    content: r.cont ?? '',
    authorName: r.nickNm,
    menuSummary: r.menuNm,
    imageUrls: r.imgUrlList?.length ? r.imgUrlList : undefined,
    reply: r.cmtCont
      ? { content: r.cmtCont, createdAt: r.cmtRegDt ? fromCompactDateTime(r.cmtRegDt) : undefined }
      : undefined,
  };
}

export function mapBaeminMenu(r: RawBaeminMenu): MenuItem {
  return {
    platform: P,
    storeId: String(r.shopNo),
    menuId: String(r.menuNo),
    name: r.menuNm,
    category: r.menuGrpNm,
    price: toWon(r.price),
    soldOut: r.soldOutYn === 'Y',
  };
}

export function mapBaeminAds(rows: RawBaeminAd[], range: DateRange): AdSpend[] {
  return rows.flatMap((r) =>
    prorateAd(
      P,
      String(r.shopNo),
      r.adProdNm,
      { from: fromCompactDate(r.adStDt), to: fromCompactDate(r.adEdDt) },
      toWon(r.adAmt),
      range,
      { clicks: r.clickCnt != null ? toInt(r.clickCnt) : undefined, impressions: r.impCnt != null ? toInt(r.impCnt) : undefined },
    ),
  );
}

export function clampRating(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(5, Math.max(1, Math.round(n)));
}
