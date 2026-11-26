import type { DeliveryAdapter } from '../types.ts';
import type { AccountStatus, AdapterCapabilities, AdSpend, DateRange, MenuItem, Order, Review, SalesRecord, Store } from '../../model.ts';
import { clampRangeToToday } from '../../util.ts';
import { HyphenError, listOf, toHyphenDate, type HyphenTransport } from './client.ts';
import {
  mapBaeminAds, mapBaeminMenu, mapBaeminOrder, mapBaeminReview, mapBaeminSales, mapBaeminShop,
  type RawBaeminAd, type RawBaeminMenu, type RawBaeminOrder, type RawBaeminReview, type RawBaeminSale,
  type RawBaeminSettle, type RawBaeminShop,
} from './baemin.mapping.ts';

/**
 * 하이픈 '배달의민족' 상품(14개 API) 중 대시보드에 쓰는 것들의 엔드포인트.
 * TODO: 실제 경로는 계약 후 연동 가이드로 교체 (지금 값은 자리표시자)
 * 아직 쓰지 않는 API: PG매출, 계좌정보, 통계(일/요일/시간대 — 주문내역으로 직접 계산), 우리가게NOW, 인근지역매출
 */
export const BAEMIN_ENDPOINTS = {
  verify: '/baemin/account/verify', // 계정검증
  shops: '/baemin/shop-info', // 음식점정보(수수료율 포함) / 내 가게
  sales: '/baemin/sales', // 매출조회
  settlements: '/baemin/settlements', // 정산내역
  orders: '/baemin/orders', // 주문내역
  reviews: '/baemin/reviews', // 리뷰
  menus: '/baemin/menus', // 메뉴
  ads: '/baemin/ads', // 광고관리
} as const;

export interface BaeminCredentials {
  loginId: string;
  loginPw: string;
}

export class HyphenBaeminAdapter implements DeliveryAdapter {
  readonly platform = 'baemin' as const;
  readonly capabilities: AdapterCapabilities = { orders: true, sales: true, reviews: true, menus: true, ads: true };
  private transport: HyphenTransport;
  private creds: BaeminCredentials;
  private mode: 'mock' | 'live';

  constructor(opts: { transport: HyphenTransport; credentials: BaeminCredentials; mode: 'mock' | 'live' }) {
    this.transport = opts.transport;
    this.creds = opts.credentials;
    this.mode = opts.mode;
  }

  /** TODO: 사장님 계정 전달 필드명 확인 (가정: loginId / loginPw) */
  private call(endpoint: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.transport(endpoint, { loginId: this.creds.loginId, loginPw: this.creds.loginPw, ...extra });
  }

  private period(range: DateRange) {
    return { stDate: toHyphenDate(range.from), edDate: toHyphenDate(range.to) };
  }

  async verifyAccount(): Promise<AccountStatus> {
    try {
      const data = (await this.call(BAEMIN_ENDPOINTS.verify)) as { verifyYn?: string };
      const ok = data?.verifyYn === 'Y';
      return { platform: this.platform, ok, source: this.mode, message: ok ? undefined : '계정 확인 실패' };
    } catch (e) {
      return { platform: this.platform, ok: false, source: this.mode, message: errorMessage(e) };
    }
  }

  async getStores(): Promise<Store[]> {
    return listOf<RawBaeminShop>(await this.call(BAEMIN_ENDPOINTS.shops)).map(mapBaeminShop);
  }

  async getSales(range: DateRange): Promise<SalesRecord[]> {
    const r = clampRangeToToday(range);
    if (!r) return [];
    const [sales, settles] = await Promise.all([
      this.call(BAEMIN_ENDPOINTS.sales, this.period(r)),
      this.call(BAEMIN_ENDPOINTS.settlements, this.period(r)),
    ]);
    return mapBaeminSales(listOf<RawBaeminSale>(sales), listOf<RawBaeminSettle>(settles));
  }

  async getOrders(range: DateRange): Promise<Order[]> {
    const r = clampRangeToToday(range);
    if (!r) return [];
    return listOf<RawBaeminOrder>(await this.call(BAEMIN_ENDPOINTS.orders, this.period(r))).map(mapBaeminOrder);
  }

  async getReviews(range: DateRange): Promise<Review[]> {
    const r = clampRangeToToday(range);
    if (!r) return [];
    return listOf<RawBaeminReview>(await this.call(BAEMIN_ENDPOINTS.reviews, this.period(r))).map(mapBaeminReview);
  }

  async getMenus(): Promise<MenuItem[]> {
    return listOf<RawBaeminMenu>(await this.call(BAEMIN_ENDPOINTS.menus)).map(mapBaeminMenu);
  }

  async getAdSpend(range: DateRange): Promise<AdSpend[]> {
    const r = clampRangeToToday(range);
    if (!r) return [];
    return mapBaeminAds(listOf<RawBaeminAd>(await this.call(BAEMIN_ENDPOINTS.ads, this.period(r))), r);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof HyphenError) return e.code ? `${e.message} (${e.code})` : e.message;
  return e instanceof Error ? e.message : String(e);
}
