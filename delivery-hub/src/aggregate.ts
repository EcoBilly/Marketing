/**
 * 대시보드 집계 로직 (순수 함수 — 입출력 없음, 테스트 대상).
 * 어댑터들이 돌려준 공통 모델 데이터를 받아 화면에 필요한 숫자를 만듭니다.
 */
import type { AdSpend, DateRange, Order, Platform, Review, SalesRecord } from './model.ts';
import { eachDay, inRange, kstParts, weekday, WEEKDAY_LABELS } from './util.ts';

export interface HubData {
  sales: SalesRecord[];
  orders: Order[];
  reviews: Review[];
  ads: AdSpend[];
}

export interface FeeBreakdown {
  commission: number;
  payment: number;
  delivery: number;
  vat: number;
  other: number;
  total: number;
}

export interface Summary {
  platform: Platform | 'all';
  salesAmount: number;
  deliveryTip: number;
  /** 음식 매출 + 배달팁 = 고객이 낸 총액 */
  grossAmount: number;
  orderCount: number;
  cancelCount: number;
  avgOrderValue: number;
  fees: FeeBreakdown;
  /** 수수료 합계 ÷ 총액 */
  feeShare: number;
  payout: number;
  adSpend: number;
  /** 광고비 ÷ 음식 매출 */
  adShare: number;
  /** 입금액 − 별도 광고비 (정산에서 이미 차감된 광고비는 fees.other 에 들어 있음) */
  netAfterAds: number;
  reviewCount: number;
  avgRating: number | null;
  lowRatingCount: number;
  unrepliedCount: number;
}

export interface Dashboard {
  range: DateRange;
  platforms: Platform[];
  lowRatingThreshold: number;
  totals: Summary;
  byPlatform: Summary[];
  daily: { date: string; sales: Partial<Record<Platform, number>>; orders: Partial<Record<Platform, number>> }[];
  hourly: { hour: number; orders: Partial<Record<Platform, number>> }[];
  weekday: { weekday: number; label: string; orders: Partial<Record<Platform, number>> }[];
  reviews: (Review & { low: boolean })[];
  ads: {
    /** 광고비가 있는 플랫폼만 매출과 나란히 */
    platforms: Platform[];
    daily: { date: string; spend: number; sales: number }[];
    byProduct: { platform: Platform; product: string; spend: number; clicks: number | null }[];
  };
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

export function summarize(platform: Platform | 'all', sales: SalesRecord[], ads: AdSpend[], reviews: Review[], lowThreshold: number): Summary {
  const s = (f: (r: SalesRecord) => number) => sales.reduce((acc, r) => acc + f(r), 0);
  const fees: FeeBreakdown = {
    commission: s((r) => r.commissionFee),
    payment: s((r) => r.paymentFee),
    delivery: s((r) => r.deliveryCost),
    vat: s((r) => r.vat),
    other: s((r) => r.otherFees),
    total: 0,
  };
  fees.total = fees.commission + fees.payment + fees.delivery + fees.vat + fees.other;
  const salesAmount = s((r) => r.salesAmount);
  const deliveryTip = s((r) => r.deliveryTip);
  const grossAmount = salesAmount + deliveryTip;
  const orderCount = s((r) => r.orderCount);
  const payout = s((r) => r.payoutAmount);
  const adSpend = ads.reduce((acc, a) => acc + a.spend, 0);
  const rated = reviews.filter((r) => r.rating > 0);
  return {
    platform,
    salesAmount,
    deliveryTip,
    grossAmount,
    orderCount,
    cancelCount: s((r) => r.cancelCount),
    avgOrderValue: Math.round(ratio(salesAmount, orderCount)),
    fees,
    feeShare: ratio(fees.total, grossAmount),
    payout,
    adSpend,
    adShare: ratio(adSpend, salesAmount),
    netAfterAds: payout - adSpend,
    reviewCount: reviews.length,
    avgRating: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating, 0) / rated.length) * 100) / 100 : null,
    lowRatingCount: reviews.filter((r) => r.rating > 0 && r.rating <= lowThreshold).length,
    unrepliedCount: reviews.filter((r) => !r.reply).length,
  };
}

export function buildDashboard(
  data: HubData,
  range: DateRange,
  opts: { platforms: Platform[]; lowRatingThreshold?: number; reviewLimit?: number },
): Dashboard {
  const low = opts.lowRatingThreshold ?? 3;
  const want = new Set(opts.platforms);
  const sales = data.sales.filter((r) => want.has(r.platform) && inRange(r.date, range));
  const ads = data.ads.filter((a) => want.has(a.platform) && inRange(a.date, range));
  const orders = data.orders.filter((o) => want.has(o.platform) && inRange(kstParts(o.orderedAt).date, range));
  const reviews = data.reviews.filter((r) => want.has(r.platform) && inRange(kstParts(r.createdAt).date, range));

  const byPlatform = opts.platforms.map((p) =>
    summarize(p, sales.filter((r) => r.platform === p), ads.filter((a) => a.platform === p), reviews.filter((r) => r.platform === p), low),
  );

  const days = eachDay(range);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const daily: Dashboard['daily'] = days.map((date) => ({ date, sales: {}, orders: {} }));
  for (const r of sales) {
    const row = daily[dayIndex.get(r.date)!];
    row.sales[r.platform] = (row.sales[r.platform] ?? 0) + r.salesAmount;
  }

  const hourly: Dashboard['hourly'] = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: {} }));
  const week: Dashboard['weekday'] = WEEKDAY_LABELS.map((label, i) => ({ weekday: i, label, orders: {} }));
  for (const o of orders) {
    if (o.status !== 'completed') continue;
    const { date, hour } = kstParts(o.orderedAt);
    const d = daily[dayIndex.get(date)!];
    d.orders[o.platform] = (d.orders[o.platform] ?? 0) + 1;
    hourly[hour].orders[o.platform] = (hourly[hour].orders[o.platform] ?? 0) + 1;
    const w = week[weekday(date)];
    w.orders[o.platform] = (w.orders[o.platform] ?? 0) + 1;
  }

  const adPlatforms = [...new Set(ads.map((a) => a.platform))];
  const adDaily = days.map((date) => ({ date, spend: 0, sales: 0 }));
  for (const a of ads) adDaily[dayIndex.get(a.date)!].spend += a.spend;
  for (const r of sales) if (adPlatforms.includes(r.platform)) adDaily[dayIndex.get(r.date)!].sales += r.salesAmount;
  const productMap = new Map<string, { platform: Platform; product: string; spend: number; clicks: number | null }>();
  for (const a of ads) {
    const k = `${a.platform}|${a.product}`;
    const cur = productMap.get(k) ?? { platform: a.platform, product: a.product, spend: 0, clicks: null };
    cur.spend += a.spend;
    if (a.clicks != null) cur.clicks = (cur.clicks ?? 0) + a.clicks;
    productMap.set(k, cur);
  }

  const mergedReviews = reviews
    .map((r) => ({ ...r, low: r.rating > 0 && r.rating <= low }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, opts.reviewLimit ?? 300);

  return {
    range,
    platforms: opts.platforms,
    lowRatingThreshold: low,
    totals: summarize('all', sales, ads, reviews, low),
    byPlatform,
    daily,
    hourly,
    weekday: week,
    reviews: mergedReviews,
    ads: { platforms: adPlatforms, daily: adDaily, byProduct: [...productMap.values()].sort((a, b) => b.spend - a.spend) },
  };
}
