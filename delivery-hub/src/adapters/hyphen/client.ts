/**
 * 하이픈(Hyphen) API마켓 공통 클라이언트.
 *
 * 하이픈의 배달 상품(배민·쿠팡이츠)은 'TR시그니처' 상품으로, 계약·심사 후에만
 * 연동 가이드(엔드포인트·인증 방식·필드명)를 받을 수 있습니다. 그래서 아래 내용은 모두 '가정'입니다.
 *
 * TODO(계약 후 확인):
 *  - Base URL (현재 가정: https://api.hyphen.im)
 *  - 인증 헤더 이름 (현재 가정: 'user-id' + 'Hkey'). 토큰 발급 방식(OAuth 등)일 수도 있음
 *  - 공통 응답 봉투 (현재 가정: { common: { errYn, errCd, errMsg }, data })
 *  - 사장님 계정(아이디/비밀번호) 전달 방식 — 평문 전달인지, 암호화(공개키) 필드인지
 *  - 호출 제한(rate limit)·과금 단위, 조회 가능 기간(최대 몇 개월)
 *
 * 어댑터는 HyphenTransport 인터페이스만 쓰므로, MOCK 모드에서는 가짜 전송계층으로 바꿔 끼웁니다.
 */

export interface HyphenEnvelope<T> {
  common?: { errYn?: string; errCd?: string; errMsg?: string; hyphenTrNo?: string };
  data?: T;
}

/** 엔드포인트 이름 + 요청 본문 → data 부분 */
export type HyphenTransport = (endpoint: string, body: Record<string, unknown>) => Promise<unknown>;

export class HyphenError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'HyphenError';
    this.code = code;
  }
}

export interface HyphenConfig {
  baseUrl: string;
  userId: string;
  hkey: string;
  timeoutMs: number;
}

export function isHyphenConfigured(c: HyphenConfig): boolean {
  return Boolean(c.baseUrl && c.userId && c.hkey);
}

/** 실제 HTTP 전송계층 */
export function createHttpTransport(config: HyphenConfig): HyphenTransport {
  return async (endpoint, body) => {
    if (!isHyphenConfigured(config)) {
      throw new HyphenError('하이픈 API 키가 설정되지 않았습니다 (.env 의 HYPHEN_USER_ID / HYPHEN_HKEY).', 'NO_CONFIG');
    }
    const url = config.baseUrl.replace(/\/+$/, '') + endpoint;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // TODO: 실제 헤더 이름은 연동 가이드로 확인
        'user-id': config.userId,
        Hkey: config.hkey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) throw new HyphenError(`하이픈 HTTP ${res.status}`, `HTTP_${res.status}`);
    const json = (await res.json()) as HyphenEnvelope<unknown>;
    return unwrapEnvelope(json);
  };
}

export function unwrapEnvelope<T>(json: HyphenEnvelope<T>): T {
  if (json.common?.errYn === 'Y') {
    // 스크래핑 기반이라 비밀번호 변경·2차 인증·플랫폼 화면 개편 시 여기서 실패합니다.
    throw new HyphenError(json.common.errMsg || '하이픈 조회 실패', json.common.errCd);
  }
  return (json.data ?? ({} as T)) as T;
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' (하이픈 요청 날짜 형식 가정) */
export function toHyphenDate(date: string): string {
  return date.replace(/-/g, '');
}

/** 'YYYYMMDD' 또는 'YYYY-MM-DD' → 'YYYY-MM-DD' */
export function fromCompactDate(s: string): string {
  const d = String(s).replace(/[^0-9]/g, '');
  if (d.length < 8) throw new Error(`날짜 형식 오류: ${s}`);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** 'YYYYMMDDHHmmss' / 'YYYY-MM-DD HH:mm(:ss)' → KST ISO */
export function fromCompactDateTime(s: string): string {
  const d = String(s).replace(/[^0-9]/g, '');
  if (d.length < 12) throw new Error(`일시 형식 오류: ${s}`);
  const ss = d.length >= 14 ? d.slice(12, 14) : '00';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${ss}+09:00`;
}

/** 응답에서 목록 꺼내기: data.list 또는 data 자체가 배열인 경우 모두 허용 */
export function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { list?: unknown }).list)) {
    return (data as { list: T[] }).list;
  }
  return [];
}
