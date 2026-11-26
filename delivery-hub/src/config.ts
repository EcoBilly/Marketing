/** 환경설정 (.env) 읽기. 비밀값은 서버 안에서만 쓰고 화면(API 응답)으로 절대 내보내지 않습니다. */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface AppConfig {
  mock: boolean;
  host: string;
  port: number;
  lowRatingThreshold: number;
  hyphen: { baseUrl: string; userId: string; hkey: string; timeoutMs: number };
  baemin: { loginId: string; loginPw: string };
  coupangeats: { loginId: string; loginPw: string };
  mukkebi: { importDir: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const envFile = resolve(ROOT, '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);
  const e = (k: string, d = '') => (env[k] ?? d).trim();
  return {
    mock: e('MOCK_MODE', 'true').toLowerCase() !== 'false',
    host: e('HOST', '127.0.0.1'),
    port: Number(e('PORT', '8787')) || 8787,
    lowRatingThreshold: Number(e('LOW_RATING_THRESHOLD', '3')) || 3,
    hyphen: {
      baseUrl: e('HYPHEN_BASE_URL', 'https://api.hyphen.im'),
      userId: e('HYPHEN_USER_ID'),
      hkey: e('HYPHEN_HKEY'),
      timeoutMs: Number(e('HYPHEN_TIMEOUT_MS', '60000')) || 60000,
    },
    baemin: { loginId: e('BAEMIN_LOGIN_ID'), loginPw: e('BAEMIN_LOGIN_PW') },
    coupangeats: { loginId: e('COUPANGEATS_LOGIN_ID'), loginPw: e('COUPANGEATS_LOGIN_PW') },
    mukkebi: { importDir: resolve(ROOT, e('MUKKEBI_IMPORT_DIR', './data/mukkebi')) },
  };
}
