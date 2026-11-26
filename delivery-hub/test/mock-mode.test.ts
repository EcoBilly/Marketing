import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { createAdapters, loadHubData } from '../src/hub.ts';
import { buildDashboard } from '../src/aggregate.ts';
import { PLATFORMS } from '../src/model.ts';

test('MOCK 모드: 세 플랫폼 모두 오류 없이 데이터가 나오고, 정산과 주문 수가 서로 맞는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mkb-empty-'));
  try {
    const config = loadConfig({ MOCK_MODE: 'true', MUKKEBI_IMPORT_DIR: dir });
    const range = { from: '2026-10-01', to: '2026-10-31' };
    const { data, status } = await loadHubData(createAdapters(config), range);
    for (const s of status) {
      assert.equal(s.account.ok, true, s.platform);
      assert.equal(s.account.source, 'mock');
      assert.deepEqual(s.errors, []);
    }
    for (const p of PLATFORMS) {
      const sales = data.sales.filter((r) => r.platform === p);
      const orders = data.orders.filter((o) => o.platform === p && o.status === 'completed');
      assert.equal(sales.length, 31, `${p} 일별 매출 31일`);
      assert.equal(sales.reduce((s, r) => s + r.orderCount, 0), orders.length, `${p} 주문 수 일치`);
      assert.equal(sales.reduce((s, r) => s + r.salesAmount, 0), orders.reduce((s, o) => s + o.orderAmount, 0), `${p} 매출 일치`);
      // 순정산 = 매출 + 팁 − 수수료
      for (const r of sales) {
        assert.equal(r.payoutAmount, r.salesAmount + r.deliveryTip - r.commissionFee - r.paymentFee - r.deliveryCost - r.vat - r.otherFees);
      }
      assert.ok(data.reviews.some((r) => r.platform === p), `${p} 리뷰 있음`);
    }
    assert.ok(data.ads.length > 0 && data.ads.every((a) => a.platform === 'baemin'));
    const d = buildDashboard(data, range, { platforms: [...PLATFORMS] });
    assert.ok(d.totals.feeShare > 0.05 && d.totals.feeShare < 0.3);
    // 샘플 데이터는 결정적: 같은 기간을 다시 조회하면 같은 숫자
    const again = await loadHubData(createAdapters(config), range);
    assert.equal(buildDashboard(again.data, range, { platforms: [...PLATFORMS] }).totals.payout, d.totals.payout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('실연동 모드인데 키가 없으면: 해당 플랫폼만 오류 표시, 나머지는 계속', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mkb-empty-'));
  try {
    const config = loadConfig({ MOCK_MODE: 'false', MUKKEBI_IMPORT_DIR: dir });
    const { status } = await loadHubData(createAdapters(config), { from: '2026-10-01', to: '2026-10-02' });
    const baemin = status.find((s) => s.platform === 'baemin')!;
    assert.equal(baemin.account.ok, false);
    assert.match(baemin.account.message ?? '', /HYPHEN_USER_ID/);
    assert.equal(status.find((s) => s.platform === 'mukkebi')!.account.source, 'empty');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
