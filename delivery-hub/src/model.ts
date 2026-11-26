/**
 * 공통 데이터 모델.
 * 배민·쿠팡이츠·먹깨비에서 가져온 데이터는 모두 이 형태로 바뀌고,
 * 모든 레코드에 출처 플랫폼(platform)이 붙습니다.
 *
 * 규칙
 * - 금액은 모두 원(KRW) 정수.
 * - 날짜는 'YYYY-MM-DD'(한국시간 기준), 일시는 '+09:00' 오프셋이 붙은 ISO 문자열.
 */

export const PLATFORMS = ['baemin', 'coupangeats', 'mukkebi'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  baemin: '배달의민족',
  coupangeats: '쿠팡이츠',
  mukkebi: '먹깨비',
};

/** 'YYYY-MM-DD' ~ 'YYYY-MM-DD' (양 끝 포함) */
export interface DateRange {
  from: string;
  to: string;
}

export interface Store {
  platform: Platform;
  storeId: string;
  name: string;
  category?: string;
  address?: string;
  phone?: string;
  /** 중개수수료율 (0.068 = 6.8%) — 알 수 있을 때만 */
  commissionRate?: number;
}

export type OrderStatus = 'completed' | 'cancelled';

export interface Order {
  platform: Platform;
  orderId: string;
  storeId: string;
  /** 주문 일시 (KST, ISO) */
  orderedAt: string;
  status: OrderStatus;
  /** 대표 메뉴 요약, 예: "후라이드치킨 외 1건" */
  menuSummary: string;
  /** 음식 금액 (배달팁 제외) */
  orderAmount: number;
  /** 고객이 낸 배달팁 */
  deliveryTip: number;
  /** 결제 방식: 앱결제(온라인) / 만나서결제(현장) */
  paymentMethod: 'online' | 'offline';
  /** 배달 방식: 가게배달 / 플랫폼배달(배민1·쿠팡 자체배달 등) / 포장 */
  deliveryType?: 'store' | 'platform' | 'pickup';
}

/**
 * 매출·정산 (일별 · 매장별 · 매출일 기준).
 * 정산은 플랫폼마다 주기(주정산·일정산)가 달라서, 비교하기 쉽도록 '매출일' 단위로 맞춥니다.
 *
 * 순정산액 = salesAmount + deliveryTip − (commissionFee + paymentFee + deliveryCost + vat + otherFees)
 * (원천 데이터가 payoutAmount 를 주면 그 값을 우선합니다.)
 */
export interface SalesRecord {
  platform: Platform;
  storeId: string;
  /** 매출일 */
  date: string;
  /** 정산(입금) 예정일 — 알 수 있을 때만 */
  settleDate?: string;
  orderCount: number;
  cancelCount: number;
  /** 음식 매출 (배달팁 제외, 취소 제외) */
  salesAmount: number;
  /** 고객 배달팁 수입 */
  deliveryTip: number;
  /** 중개(주문) 수수료 */
  commissionFee: number;
  /** 결제(PG) 수수료 */
  paymentFee: number;
  /** 사장님이 부담한 배달비 (플랫폼 배달·대행) */
  deliveryCost: number;
  /** 수수료에 붙는 부가세 */
  vat: number;
  /** 정산에서 차감된 광고비·기타 */
  otherFees: number;
  /** 실제 입금(정산)액 */
  payoutAmount: number;
}

export interface ReviewReply {
  content: string;
  createdAt?: string;
}

export interface Review {
  platform: Platform;
  reviewId: string;
  storeId: string;
  createdAt: string;
  /** 1~5 */
  rating: number;
  content: string;
  authorName?: string;
  menuSummary?: string;
  imageUrls?: string[];
  reply?: ReviewReply;
}

export interface MenuItem {
  platform: Platform;
  storeId: string;
  menuId: string;
  name: string;
  category?: string;
  price: number;
  soldOut: boolean;
}

export interface AdSpend {
  platform: Platform;
  storeId: string;
  date: string;
  /** 광고 상품명, 예: "우리가게클릭", "울트라콜" */
  product: string;
  spend: number;
  impressions?: number;
  clicks?: number;
}

/** 어댑터가 지원하는 데이터 종류 (지원하지 않으면 대시보드에 '미지원'으로 표시) */
export interface AdapterCapabilities {
  orders: boolean;
  sales: boolean;
  reviews: boolean;
  menus: boolean;
  ads: boolean;
}

export interface AccountStatus {
  platform: Platform;
  ok: boolean;
  /** 'mock' | 'live' | 'import' | 'empty' */
  source: 'mock' | 'live' | 'import' | 'empty';
  message?: string;
}
