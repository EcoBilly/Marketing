/** 어댑터 묶음: 플랫폼별로 병렬 조회하고, 한 곳이 실패해도 나머지는 보여 줍니다. */
import type { DeliveryAdapter } from './adapters/types.ts';
import { createHttpTransport } from './adapters/hyphen/client.ts';
import { HyphenBaeminAdapter } from './adapters/hyphen/baemin.ts';
import { createBaeminMockTransport } from './adapters/hyphen/baemin.mock.ts';
import { HyphenCoupangEatsAdapter } from './adapters/hyphen/coupangeats.ts';
import { createCoupangMockTransport } from './adapters/hyphen/coupangeats.mock.ts';
import { MukkebiAdapter } from './adapters/mukkebi/adapter.ts';
import type { AppConfig } from './config.ts';
import type { AccountStatus, AdapterCapabilities, DateRange, Platform } from './model.ts';
import type { HubData } from './aggregate.ts';

export function createAdapters(config: AppConfig): DeliveryAdapter[] {
  const mode = config.mock ? 'mock' : 'live';
  const http = createHttpTransport(config.hyphen);
  return [
    new HyphenBaeminAdapter({ mode, credentials: config.baemin, transport: config.mock ? createBaeminMockTransport() : http }),
    new HyphenCoupangEatsAdapter({ mode, credentials: config.coupangeats, transport: config.mock ? createCoupangMockTransport() : http }),
    new MukkebiAdapter({ importDir: config.mukkebi.importDir, mock: config.mock }),
  ];
}

export interface PlatformStatus {
  platform: Platform;
  account: AccountStatus;
  capabilities: AdapterCapabilities;
  errors: string[];
}

export async function loadHubData(adapters: DeliveryAdapter[], range: DateRange): Promise<{ data: HubData; status: PlatformStatus[] }> {
  const data: HubData = { sales: [], orders: [], reviews: [], ads: [] };
  const status = await Promise.all(
    adapters.map(async (a): Promise<PlatformStatus> => {
      const errors: string[] = [];
      const account = await a.verifyAccount();
      const grab = async <T>(label: string, enabled: boolean, f: () => Promise<T[]>): Promise<T[]> => {
        if (!enabled || !account.ok) return [];
        try {
          return await f();
        } catch (e) {
          errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
          return [];
        }
      };
      const [sales, orders, reviews, ads] = await Promise.all([
        grab('매출·정산', a.capabilities.sales, () => a.getSales(range)),
        grab('주문', a.capabilities.orders, () => a.getOrders(range)),
        grab('리뷰', a.capabilities.reviews, () => a.getReviews(range)),
        grab('광고', a.capabilities.ads, () => a.getAdSpend(range)),
      ]);
      data.sales.push(...sales);
      data.orders.push(...orders);
      data.reviews.push(...reviews);
      data.ads.push(...ads);
      return { platform: a.platform, account, capabilities: a.capabilities, errors };
    }),
  );
  return { data, status };
}
