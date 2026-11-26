import type { AdSpend, DateRange, Platform } from '../model.ts';
import { addDays, daysBetween } from '../util.ts';

/**
 * 기간형 광고비(예: 울트라콜 월 88,000원)를 하루 단위로 나눕니다.
 * 원 단위 반올림 오차는 마지막 날에 몰아서 합계가 원금과 정확히 같게 합니다.
 * 결과는 조회 기간(range)과 겹치는 날만 돌려줍니다.
 */
export function prorateAd(
  platform: Platform,
  storeId: string,
  product: string,
  period: DateRange,
  spend: number,
  range: DateRange,
  extra: { impressions?: number; clicks?: number } = {},
): AdSpend[] {
  const days = daysBetween(period.from, period.to) + 1;
  if (days <= 0) return [];
  const perDay = Math.floor(spend / days);
  const out: AdSpend[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(period.from, i);
    if (date < range.from || date > range.to) continue;
    const amount = i === days - 1 ? spend - perDay * (days - 1) : perDay;
    const rec: AdSpend = { platform, storeId, date, product, spend: amount };
    if (days === 1) Object.assign(rec, extra);
    out.push(rec);
  }
  return out;
}
