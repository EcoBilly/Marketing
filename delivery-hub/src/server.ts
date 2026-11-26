/**
 * 대시보드 서버 (Node 기본 http 모듈만 사용).
 *   GET  /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&platforms=baemin,coupangeats,mukkebi
 *   GET  /api/mukkebi/files          가져온 먹깨비 파일 목록
 *   POST /api/mukkebi/import?name=…  먹깨비 CSV/XLSX 업로드 (본문 = 파일 바이트)
 *   DELETE /api/mukkebi/files        가져온 파일 모두 삭제 (샘플 데이터로 돌아감)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { loadConfig, ROOT, type AppConfig } from './config.ts';
import { createAdapters, loadHubData } from './hub.ts';
import { buildDashboard } from './aggregate.ts';
import { PLATFORMS, type Platform } from './model.ts';
import { addDays, daysBetween, isDate, todayKst } from './util.ts';
import { loadImportDir, MUKKEBI_EXTENSIONS, readTable } from './adapters/mukkebi/adapter.ts';
import { detectKind } from './adapters/mukkebi/mapping.ts';

const PUBLIC = resolve(ROOT, 'public');
const MAX_UPLOAD = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { fail(new Error('파일이 너무 큽니다 (최대 10MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

export function createApp(config: AppConfig) {
  const adapters = createAdapters(config);

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/dashboard' && req.method === 'GET') {
        const today = todayKst();
        const to = url.searchParams.get('to') || today;
        const from = url.searchParams.get('from') || addDays(to, -29);
        if (!isDate(from) || !isDate(to) || from > to) return json(res, 400, { error: '기간이 올바르지 않습니다' });
        if (daysBetween(from, to) > 366) return json(res, 400, { error: '최대 1년까지 조회할 수 있습니다' });
        const requested = (url.searchParams.get('platforms') || PLATFORMS.join(','))
          .split(',').filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
        const range = { from, to };
        const { data, status } = await loadHubData(adapters.filter((a) => requested.includes(a.platform)), range);
        const dashboard = buildDashboard(data, range, { platforms: requested, lowRatingThreshold: config.lowRatingThreshold });
        return json(res, 200, { mock: config.mock, today, dashboard, status });
      }

      if (url.pathname === '/api/mukkebi/files' && req.method === 'GET') {
        return json(res, 200, { files: loadImportDir(config.mukkebi.importDir).files });
      }

      if (url.pathname === '/api/mukkebi/files' && req.method === 'DELETE') {
        if (existsSync(config.mukkebi.importDir)) {
          for (const n of readdirSync(config.mukkebi.importDir)) {
            if (MUKKEBI_EXTENSIONS.test(n)) rmSync(join(config.mukkebi.importDir, n));
          }
        }
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/api/mukkebi/import' && req.method === 'POST') {
        const raw = basename(url.searchParams.get('name') || '');
        if (!MUKKEBI_EXTENSIONS.test(raw)) return json(res, 400, { error: 'CSV 또는 XLSX 파일만 올릴 수 있습니다' });
        const buf = await readBody(req, MAX_UPLOAD);
        const rows = readTable(raw, buf);
        const { kind } = detectKind(rows);
        if (kind === 'unknown') return json(res, 400, { error: '먹깨비 주문/리뷰 파일로 인식하지 못했습니다. 열 이름을 확인해 주세요.' });
        mkdirSync(config.mukkebi.importDir, { recursive: true });
        const safe = `${Date.now()}_${raw.replace(/[^\w.가-힣-]/g, '_')}`;
        writeFileSync(join(config.mukkebi.importDir, safe), buf);
        const summary = loadImportDir(config.mukkebi.importDir).files.find((f) => f.name === safe);
        return json(res, 200, { ok: true, kind, file: summary });
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

      // 정적 파일
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const base = rel.startsWith('samples/') ? ROOT : PUBLIC;
      const file = resolve(base, rel);
      if (!file.startsWith(base + sep) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch (e) {
      console.error(e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  createServer(createApp(config)).listen(config.port, config.host, () => {
    console.log(`\n  🛵 delivery-hub ${config.mock ? '(MOCK 모드 — 샘플 데이터)' : '(실연동 모드)'}`);
    console.log(`  → http://${config.host}:${config.port}\n`);
  });
}
