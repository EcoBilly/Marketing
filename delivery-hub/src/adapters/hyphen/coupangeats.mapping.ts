/**
 * 쿠팡이츠(하이픈 상품 seq=186) 원본 응답 → 공통 모델 매핑.
 *
 * ⚠️ 원본 필드명은 모두 '가정'입니다. 배민과 일부러 다른 모양(camelCase 영문, 'YYYY-MM-DD' 날짜)으로
 * 잡아서, 플랫폼마다 응답이 달라도 매핑 계층에서 흡수된다는 걸 보여 줍니다.
 * 계약 후 실제 필드명으로 Raw* 타입과 map* 함수만 교체하세요.
 *
 * 하이픈 쿠팡이츠 상품에는 '광고관리' API가 없습니다 → 광고비는 미지원.
 */
import type { MenuItem, Order, Review, SalesRecord, Store } from '../../model.ts';
import { toInt, toWon } from '../../util.ts';
import { clampRating } from './baemin.mapping.ts';
import { fromCompactDate, fromCompactDateTime } from './client.ts';

const P = 'coupangeats' as const;

export interface RawCoupangStore {
  storeId: string;
  storeName: string;
  categoryName?: string;
  address?: string;
  phone?: string;
  commissionRate?: number; // 0.078 형태 가정
}

/** 매출 + 정산을 한 줄로 준다고 가정 (실제로 '매출'과 '정산'이 따로면 배민처럼 합치면 됨) */
export interface RawCoupangSettlement {
  storeId: string;
  salesDate: string; // YYYY-MM-DD
  settlementDate?: string;
  orderCount: number;
  cancelCount: number;
  salesAmount: number; // 음식 매출
  customerDeliveryFee: number; // 고객 배달비(배달팁)
  commission: number; // 중개수수료
  pgFee: number; // 결제대행 수수료
  deliveryCharge: number; // 배달비(사장님 부담)
  vat: number;
  adjustment?: number; // 기타 조정(차감은 음수) — TODO: 부호 규칙 확인
  settlementAmount: number;
}

export interface RawCoupangOrder {
  orderId: string;
  storeId: string;
  orderDateTime: string; // 'YYYY-MM-DD HH:mm:ss'
  status: 'COMPLETED' | 'CANCELLED' | 'REJECTED' | string;
  items: { name: string; quantity: number; price: number }[];
  totalAmount: number; // 음식 금액
  customerDeliveryFee: number;
  paymentType?: string; // 'CARD' 등 — 쿠팡이츠는 앱결제만 있다고 가정
  deliveryType?: 'COUPANG' | 'STORE' | 'PICKUP' | string;
}

/** 리뷰 — 날짜, 시간, 별점, 주문내역, 내용 */
export interface RawCoupangReview {
  reviewId: string;
  storeId: string;
  reviewDate: string; // YYYY-MM-DD
  reviewTime: string; // HH:mm
  rating: number;
  orderItems: string;
  content: string;
  ownerReply?: string;
  // TODO: 하이픈 목록에 이미지·작성자 필드가 없음 — 실제 응답 확인
}

export interface RawCoupangMenu {
  menuId: string;
  storeId: string;
  name: string;
  groupName?: string;
  salePrice: number;
  status: 'ON_SALE' | 'SOLD_OUT' | string;
}

export function mapCoupangStore(r: RawCoupangStore): Store {
  return {
    platform: P,
    storeId: String(r.storeId),
    name: r.storeName,
    category: r.categoryName,
    address: r.address,
    phone: r.phone,
    commissionRate: r.commissionRate,
  };
}

export function mapCoupangSettlement(r: RawCoupangSettlement): SalesRecord {
  const adj = toWon(r.adjustment);
  return {
    platform: P,
    storeId: String(r.storeId),
    date: fromCompactDate(r.salesDate),
    settleDate: r.settlementDate ? fromCompactDate(r.settlementDate) : undefined,
    orderCount: toInt(r.orderCount),
    cancelCount: toInt(r.cancelCount),
    salesAmount: toWon(r.salesAmount),
    deliveryTip: toWon(r.customerDeliveryFee),
    commissionFee: toWon(r.commission),
    paymentFee: toWon(r.pgFee),
    deliveryCost: toWon(r.deliveryCharge),
    vat: toWon(r.vat),
    otherFees: adj < 0 ? -adj : 0,
    payoutAmount: toWon(r.settlementAmount),
  };
}

export function mapCoupangOrder(r: RawCoupangOrder): Order {
  const items = r.items ?? [];
  const first = items[0] ? `${items[0].name}${items[0].quantity > 1 ? ` x${items[0].quantity}` : ''}` : '';
  return {
    platform: P,
    orderId: String(r.orderId),
    storeId: String(r.storeId),
    orderedAt: fromCompactDateTime(r.orderDateTime),
    status: r.status === 'COMPLETED' ? 'completed' : 'cancelled',
    menuSummary: items.length > 1 ? `${first} 외 ${items.length - 1}건` : first,
    orderAmount: toWon(r.totalAmount),
    deliveryTip: toWon(r.customerDeliveryFee),
    paymentMethod: 'online',
    deliveryType: r.deliveryType === 'PICKUP' ? 'pickup' : r.deliveryType === 'STORE' ? 'store' : 'platform',
  };
}

export function mapCoupangReview(r: RawCoupangReview): Review {
  return {
    platform: P,
    reviewId: String(r.reviewId),
    storeId: String(r.storeId),
    createdAt: fromCompactDateTime(`${r.reviewDate} ${r.reviewTime}`),
    rating: clampRating(r.rating),
    content: r.content ?? '',
    menuSummary: r.orderItems,
    reply: r.ownerReply ? { content: r.ownerReply } : undefined,
  };
}

export function mapCoupangMenu(r: RawCoupangMenu): MenuItem {
  return {
    platform: P,
    storeId: String(r.storeId),
    menuId: String(r.menuId),
    name: r.name,
    category: r.groupName,
    price: toWon(r.salePrice),
    soldOut: r.status === 'SOLD_OUT',
  };
}
