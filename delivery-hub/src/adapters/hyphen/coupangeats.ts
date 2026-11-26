import type { DeliveryAdapter } from '../types.ts';
import type { AccountStatus, AdapterCapabilities, AdSpend, DateRange, MenuItem, Order, Review, SalesRecord, Store } from '../../model.ts';
import { clampRangeToToday } from '../../util.ts';
import { listOf, type HyphenTransport } from './client.ts';
import { errorMessage } from './baemin.ts';
import {
  mapCoupangMenu, mapCoupangOrder, mapCoupangReview, mapCoupangSettlement, mapCoupangStore,
  type RawCoupangMenu, type RawCoupangOrder, type RawCoupangReview, type RawCoupangSettlement, type RawCoupangStore,
} from './coupangeats.mapping.ts';

/**
 * 하이픈 '쿠팡이츠' 상품(10개 API) 엔드포인트.
 * TODO: 실제 경로는 계약 후 연동 가이드로 교체 (지금 값은 자리표시자)
 * 아직 쓰지 않는 API: 계좌정보, PG매출
 */
export const COUPANG_ENDPOINTS = {
  verify: '/coupangeats/account/verify', // 계정검증
  stores: '/coupangeats/store-info', // 음식점정보 / 내 가게
  settlements: '/coupangeats/settlements', // 매출 + 정산
  orders: '/coupangeats/orders', // 주문내역
  reviews: '/coupangeats/reviews', // 리뷰
  menus: '/coupangeats/menus', // 메뉴
} as const;

export class HyphenCoupangEatsAdapter implements DeliveryAdapter {
  readonly platform = 'coupangeats' as const;
  readonly capabilities: AdapterCapabilities = { orders: true, sales: true, reviews: true, menus: true, ads: false };
  private transport: HyphenTransport;
  private creds: { loginId: string; loginPw: string };
  private mode: 'mock' | 'live';

  constructor(opts: { transport: HyphenTransport; credentials: { loginId: string; loginPw: string }; mode: 'mock' | 'live' }) {
    this.transport = opts.transport;
    this.creds = opts.credentials;
    this.mode = opts.mode;
  }

  /** TODO: 요청 필드명 가정 (loginId / loginPw / startDate / endDate, YYYYMMDD) */
  private call(endpoint: string, range?: DateRange): Promise<unknown> {
    const body: Record<string, unknown> = { loginId: this.creds.loginId, loginPw: this.creds.loginPw };
    if (range) {
      body.startDate = range.from.replace(/-/g, '');
      body.endDate = range.to.replace(/-/g, '');
    }
    return this.transport(endpoint, body);
  }

  async verifyAccount(): Promise<AccountStatus> {
    try {
      const data = (await this.call(COUPANG_ENDPOINTS.verify)) as { valid?: boolean };
      return { platform: this.platform, ok: data?.valid === true, source: this.mode, message: data?.valid ? undefined : '계정 확인 실패' };
    } catch (e) {
      return { platform: this.platform, ok: false, source: this.mode, message: errorMessage(e) };
    }
  }

  async getStores(): Promise<Store[]> {
    return listOf<RawCoupangStore>(await this.call(COUPANG_ENDPOINTS.stores)).map(mapCoupangStore);
  }

  async getSales(range: DateRange): Promise<SalesRecord[]> {
    const r = clampRangeToToday(range);
    if (!r) return [];
    return listOf<RawCoupangSettlement>(await this.call(COUPANG_ENDPOINTS.settlements, r)).map(mapCoupangSettlement);
  }

  async getOrders(range: DateRange): Promise<Order[]> {
    const r = clampRangeToToday(range);
    if (!r) return [];
    return listOf<RawCoupangOrder>(await this.call(COUPANG_ENDPOINTS.orders, r)).map(mapCoupangOrder);
  }

  async getReviews(range: DateRange): Promise<Review[]> {
    const r = clampRangeToToday(range);
    if (!r) return [];
    return listOf<RawCoupangReview>(await this.call(COUPANG_ENDPOINTS.reviews, r)).map(mapCoupangReview);
  }

  async getMenus(): Promise<MenuItem[]> {
    return listOf<RawCoupangMenu>(await this.call(COUPANG_ENDPOINTS.menus)).map(mapCoupangMenu);
  }

  /** 하이픈 쿠팡이츠 상품에 광고 API 없음 */
  async getAdSpend(_range: DateRange): Promise<AdSpend[]> {
    return [];
  }
}
