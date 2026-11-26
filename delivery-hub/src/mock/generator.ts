/**
 * MOCK 모드용 샘플 데이터 생성기.
 *
 * 플랫폼과 상관없는 '사실'(주문·수수료·리뷰·광고)을 결정적으로 만들어 내고,
 * 각 어댑터의 mock 전송계층이 이걸 그 플랫폼의 '원본 응답 모양'으로 바꿉니다.
 * 그래서 MOCK 모드에서도 실제와 똑같이 매핑 코드를 거칩니다.
 *
 * 수수료율·배달비는 2025~2026년 공개 요금제를 참고한 '예시값'입니다. 실제 계약 조건과 다를 수 있습니다.
 */
import type { Platform } from '../model.ts';
import { kstIso, seededRandom, weekday } from '../util.ts';

export interface MockLine {
  name: string;
  qty: number;
  price: number;
}

export interface MockOrder {
  orderId: string;
  date: string;
  orderedAt: string;
  status: 'completed' | 'cancelled';
  lines: MockLine[];
  orderAmount: number;
  deliveryTip: number;
  paymentMethod: 'online' | 'offline';
  deliveryType: 'store' | 'platform' | 'pickup';
  commissionFee: number;
  paymentFee: number;
  deliveryCost: number;
  vat: number;
}

export interface MockReview {
  reviewId: string;
  createdAt: string;
  rating: number;
  content: string;
  author: string;
  menuSummary: string;
  imageUrls: string[];
  reply?: { content: string; createdAt: string };
}

export interface MockAd {
  product: string;
  /** 광고 기간 (일 단위 상품이면 from=to) */
  from: string;
  to: string;
  spend: number;
  impressions?: number;
  clicks?: number;
}

export const MOCK_STORE = {
  storeId: 'STORE-001',
  name: '행복한치킨 본점',
  category: '치킨',
  address: '서울특별시 마포구 월드컵로 00',
  phone: '02-000-0000',
};

export const MOCK_MENU: { id: string; name: string; category: string; price: number; soldOut?: boolean }[] = [
  { id: 'M01', name: '후라이드치킨', category: '치킨', price: 20000 },
  { id: 'M02', name: '양념치킨', category: '치킨', price: 21000 },
  { id: 'M03', name: '반반치킨', category: '치킨', price: 21000 },
  { id: 'M04', name: '간장마늘치킨', category: '치킨', price: 22000 },
  { id: 'M05', name: '순살후라이드', category: '순살', price: 22000 },
  { id: 'M06', name: '순살양념', category: '순살', price: 23000 },
  { id: 'M07', name: '치즈볼(5개)', category: '사이드', price: 5000 },
  { id: 'M08', name: '감자튀김', category: '사이드', price: 4000 },
  { id: 'M09', name: '떡볶이', category: '사이드', price: 6000, soldOut: true },
  { id: 'M10', name: '콜라 1.25L', category: '음료', price: 2500 },
];

interface PlatformProfile {
  baseOrders: number;
  commissionRate: number;
  paymentRate: number;
  /** 플랫폼 배달일 때 사장님 부담 배달비 */
  platformDeliveryCost: number;
  /** 배달 방식 비율 [가게배달, 플랫폼배달, 포장] */
  deliveryMix: [number, number, number];
  offlineShare: number;
  reviewRate: number;
  replyRate: number;
  idPrefix: string;
}

export const PROFILES: Record<Platform, PlatformProfile> = {
  baemin: {
    baseOrders: 34, commissionRate: 0.078, paymentRate: 0.03, platformDeliveryCost: 3100,
    deliveryMix: [0.35, 0.55, 0.1], offlineShare: 0.05, reviewRate: 0.1, replyRate: 0.7, idPrefix: 'B',
  },
  coupangeats: {
    baseOrders: 22, commissionRate: 0.078, paymentRate: 0.03, platformDeliveryCost: 2900,
    deliveryMix: [0, 0.92, 0.08], offlineShare: 0, reviewRate: 0.08, replyRate: 0.5, idPrefix: 'C',
  },
  mukkebi: {
    // 공공배달앱 — 낮은 중개수수료(예시 2%), 가게배달 위주
    baseOrders: 6, commissionRate: 0.02, paymentRate: 0.025, platformDeliveryCost: 0,
    deliveryMix: [0.85, 0, 0.15], offlineShare: 0.15, reviewRate: 0.12, replyRate: 0.8, idPrefix: 'K',
  },
};

// 0~23시 주문 가중치 (점심·저녁 피크)
const HOUR_WEIGHTS = [
  1.2, 0.6, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.2, 1.5, 3.2, 2.6, 1.0, 0.8, 1.2, 3.0, 4.6, 4.8, 3.6, 2.6, 2.2, 1.8,
];
// 일~토
const WEEKDAY_FACTOR = [1.25, 0.85, 0.9, 0.95, 1.0, 1.2, 1.35];

function pickWeighted(r: () => number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

export function generateOrders(platform: Platform, date: string, storeId = MOCK_STORE.storeId): MockOrder[] {
  const p = PROFILES[platform];
  const r = seededRandom(`orders|${platform}|${storeId}|${date}`);
  const n = Math.max(0, Math.round(p.baseOrders * WEEKDAY_FACTOR[weekday(date)] * (0.75 + r() * 0.5)));
  const mains = MOCK_MENU.filter((m) => m.category === '치킨' || m.category === '순살');
  const sides = MOCK_MENU.filter((m) => (m.category === '사이드' || m.category === '음료') && !m.soldOut);
  const orders: MockOrder[] = [];
  for (let i = 0; i < n; i++) {
    const hour = pickWeighted(r, HOUR_WEIGHTS);
    const lines: MockLine[] = [];
    const main = mains[Math.floor(r() * mains.length)];
    lines.push({ name: main.name, qty: r() < 0.2 ? 2 : 1, price: main.price });
    if (r() < 0.55) {
      const side = sides[Math.floor(r() * sides.length)];
      lines.push({ name: side.name, qty: 1, price: side.price });
    }
    const orderAmount = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const dt = pickWeighted(r, p.deliveryMix);
    const deliveryType = (['store', 'platform', 'pickup'] as const)[dt];
    const paymentMethod = deliveryType !== 'pickup' && r() < p.offlineShare ? 'offline' : 'online';
    const deliveryTip = deliveryType === 'pickup' ? 0 : [0, 1000, 2000, 3000, 3000][Math.floor(r() * 5)];
    const cancelled = r() < 0.03;
    const commissionFee = cancelled ? 0 : round10(orderAmount * p.commissionRate);
    const paymentFee =
      cancelled || paymentMethod === 'offline' ? 0 : round10((orderAmount + deliveryTip) * p.paymentRate);
    const deliveryCost = cancelled || deliveryType !== 'platform' ? 0 : p.platformDeliveryCost;
    const vat = round10((commissionFee + paymentFee + deliveryCost) * 0.1);
    orders.push({
      orderId: `${p.idPrefix}${date.replace(/-/g, '')}${String(i + 1).padStart(4, '0')}`,
      date,
      orderedAt: kstIso(date, hour, Math.floor(r() * 60), Math.floor(r() * 60)),
      status: cancelled ? 'cancelled' : 'completed',
      lines,
      orderAmount,
      deliveryTip,
      paymentMethod,
      deliveryType,
      commissionFee,
      paymentFee,
      deliveryCost,
      vat,
    });
  }
  // 오늘 데이터는 '지금'까지만 (아직 안 온 시간의 주문은 만들지 않음)
  const now = Date.now();
  return orders.filter((o) => Date.parse(o.orderedAt) <= now).sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
}

export function menuSummary(lines: MockLine[]): string {
  const first = lines[0] ? `${lines[0].name}${lines[0].qty > 1 ? ` x${lines[0].qty}` : ''}` : '';
  return lines.length > 1 ? `${first} 외 ${lines.length - 1}건` : first;
}

const REVIEW_TEXTS: Record<number, string[]> = {
  5: [
    '바삭하고 너무 맛있어요! 또 시킬게요 😊',
    '배달도 빠르고 치킨이 따뜻하게 왔어요.',
    '양념이 진짜 맛있네요. 단골 될 것 같아요.',
    '순살인데 퍽퍽하지 않고 촉촉해요 최고',
    '치즈볼 서비스 감사합니다!!',
  ],
  4: ['맛있어요. 조금 짰지만 만족합니다.', '양 많고 맛있어요. 배달이 살짝 늦었어요.', '무난하게 맛있습니다.'],
  3: ['평범해요. 예전보다 양이 줄은 느낌?', '맛은 괜찮은데 좀 식어서 왔어요.'],
  2: ['튀김옷이 너무 두껍고 눅눅했어요.', '배달이 1시간 넘게 걸렸어요.'],
  1: ['주문한 메뉴랑 다르게 왔어요. 연락도 안 되네요.', '기름 냄새가 너무 심하고 덜 익은 것 같아요.'],
};
const REPLY_TEXTS: Record<'good' | 'bad', string[]> = {
  good: ['소중한 리뷰 감사합니다! 다음에도 맛있게 준비할게요 🙏', '맛있게 드셔주셔서 감사해요. 또 찾아주세요!'],
  bad: ['불편을 드려 정말 죄송합니다. 매장으로 연락 주시면 바로 조치하겠습니다.', '말씀 주신 부분 꼭 개선하겠습니다. 죄송합니다.'],
};
const NICKS = ['치킨러버', '배고픈곰', '야식왕', '마포주민', '닭다리', '냠냠', '서울시민', '퇴근길'];

export function generateReviews(platform: Platform, date: string, orders: MockOrder[]): MockReview[] {
  const p = PROFILES[platform];
  const r = seededRandom(`reviews|${platform}|${date}`);
  const out: MockReview[] = [];
  for (const o of orders) {
    if (o.status !== 'completed' || r() >= p.reviewRate) continue;
    // 별점 분포 예시: 5점 65%, 4점 20%, 3·2·1점 각 5%
    const rating = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 2, 1][Math.floor(r() * 20)];
    const texts = REVIEW_TEXTS[rating];
    const ordered = Date.parse(o.orderedAt);
    const created = new Date(ordered + (40 + Math.floor(r() * 120)) * 60000);
    if (created.getTime() > Date.now()) continue;
    const createdAt = toKstIsoFromDate(created);
    const review: MockReview = {
      reviewId: `R${o.orderId}`,
      createdAt,
      rating,
      content: texts[Math.floor(r() * texts.length)],
      author: NICKS[Math.floor(r() * NICKS.length)],
      menuSummary: menuSummary(o.lines),
      imageUrls: r() < 0.3 ? [`https://example.com/review/${o.orderId}.jpg`] : [],
    };
    if (r() < p.replyRate && created.getTime() + 3 * 3600000 <= Date.now()) {
      const pool = rating >= 4 ? REPLY_TEXTS.good : REPLY_TEXTS.bad;
      review.reply = {
        content: pool[Math.floor(r() * pool.length)],
        createdAt: toKstIsoFromDate(new Date(created.getTime() + 3 * 3600000)),
      };
    }
    out.push(review);
  }
  return out;
}

function toKstIsoFromDate(d: Date): string {
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';
}

/** 배민 광고 예시: 우리가게클릭(CPC, 일 단위) + 울트라콜(월 정액 88,000원/깃발) */
export function generateBaeminAds(date: string): MockAd[] {
  const r = seededRandom(`ads|baemin|${date}`);
  const clicks = Math.round(30 + r() * 50 * WEEKDAY_FACTOR[weekday(date)]);
  const cpc = 200 + Math.round(r() * 15) * 10;
  return [{ product: '우리가게클릭', from: date, to: date, spend: clicks * cpc, clicks, impressions: clicks * 18 }];
}

export function ultraCallPeriods(month: string /* YYYY-MM */): MockAd {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { product: '울트라콜', from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, spend: 88000 };
}
