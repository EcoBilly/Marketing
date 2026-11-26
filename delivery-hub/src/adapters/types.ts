import type {
  AccountStatus,
  AdapterCapabilities,
  AdSpend,
  DateRange,
  MenuItem,
  Order,
  Platform,
  Review,
  SalesRecord,
  Store,
} from '../model.ts';

/**
 * 모든 플랫폼 어댑터가 구현하는 단일 인터페이스.
 * 대시보드·집계 로직은 이 인터페이스만 알고, 플랫폼별 차이는 어댑터 안에 가둡니다.
 * 지원하지 않는 데이터는 빈 배열을 돌려주고 capabilities 에 false 로 표시합니다.
 */
export interface DeliveryAdapter {
  readonly platform: Platform;
  readonly capabilities: AdapterCapabilities;

  verifyAccount(): Promise<AccountStatus>;
  getStores(): Promise<Store[]>;
  getOrders(range: DateRange): Promise<Order[]>;
  getSales(range: DateRange): Promise<SalesRecord[]>;
  getReviews(range: DateRange): Promise<Review[]>;
  getMenus(): Promise<MenuItem[]>;
  getAdSpend(range: DateRange): Promise<AdSpend[]>;
}
