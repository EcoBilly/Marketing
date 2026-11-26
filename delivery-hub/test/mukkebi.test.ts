import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { parseCsv, toCsv } from '../src/adapters/mukkebi/csv.ts';
import { readXlsx } from '../src/adapters/mukkebi/xlsx.ts';
import { aggregateMukkebiSales, parseKstDateTime, parseMukkebiOrders, parseMukkebiReviews } from '../src/adapters/mukkebi/mapping.ts';
import { MukkebiAdapter } from '../src/adapters/mukkebi/adapter.ts';

const SAMPLE = new URL('../samples/mukkebi_orders_sample.csv', import.meta.url);

test('CSV: BOM·따옴표·쉼표 포함 셀·CRLF·빈 줄', () => {
  const rows = parseCsv('﻿이름,금액\r\n"치킨, 반반","25,000"\r\n\r\n"따옴표""안"",x",3\n');
  assert.deepEqual(rows, [['이름', '금액'], ['치킨, 반반', '25,000'], ['따옴표"안",x', '3']]);
  assert.deepEqual(parseCsv(toCsv([['a,b', 1]])), [['a,b', '1']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('일시 형식 여러 가지', () => {
  assert.equal(parseKstDateTime('2026-11-20 18:30'), '2026-11-20T18:30:00+09:00');
  assert.equal(parseKstDateTime('2026.11.20 18:30:12'), '2026-11-20T18:30:12+09:00');
  assert.equal(parseKstDateTime('2026/11/20 오후 6:05'), '2026-11-20T18:05:00+09:00');
  assert.equal(parseKstDateTime('2026-11-20 오전 12:10'), '2026-11-20T00:10:00+09:00');
  assert.equal(parseKstDateTime('20261120183012'), '2026-11-20T18:30:12+09:00');
  assert.equal(parseKstDateTime('46346.75'), '2026-11-20T18:00:00+09:00'); // 엑셀 일련번호
  assert.throws(() => parseKstDateTime('어제'));
});

test('샘플 CSV 를 읽어 주문·일별 정산으로 바꾼다 (취소는 금액 제외)', () => {
  const parsed = parseMukkebiOrders(parseCsv(readFileSync(SAMPLE, 'utf8')));
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.rows.length > 20);
  assert.ok(parsed.rows.every((r) => r.order.platform === 'mukkebi'));
  const sales = aggregateMukkebiSales(parsed.rows);
  const completed = parsed.rows.filter((r) => r.order.status === 'completed');
  assert.equal(sales.reduce((s, r) => s + r.orderCount, 0), completed.length);
  assert.equal(sales.reduce((s, r) => s + r.salesAmount, 0), completed.reduce((s, r) => s + r.order.orderAmount, 0));
  assert.equal(sales.reduce((s, r) => s + r.payoutAmount, 0), completed.reduce((s, r) => s + (r.payout ?? 0), 0));
});

test('열 이름 별칭·위쪽 제목줄·합계줄 처리, 정산금액 없으면 계산', () => {
  const rows = parseCsv([
    '먹깨비 주문내역 (2026-11-01 ~ 2026-11-01)',
    '주문 일시,주문번호,상태,메뉴명,음식금액,배달료,결제수단,중개이용료,카드수수료',
    '2026-11-01 12:00,A1,완료,치킨,"20,000원",2000,앱결제,400,550',
    '2026-11-01 13:00,A2,주문취소,치킨,20000,0,앱결제,0,0',
    '합계,,,,40000,2000,,400,550',
  ].join('\n'));
  const { rows: out, errors } = parseMukkebiOrders(rows);
  assert.deepEqual(errors, []);
  assert.equal(out.length, 2);
  const [day] = aggregateMukkebiSales(out);
  assert.equal(day.orderCount, 1);
  assert.equal(day.cancelCount, 1);
  assert.equal(day.payoutAmount, 20000 + 2000 - 400 - 550);
});

test('필수 열이 없으면 어떤 열이 없는지 알려준다', () => {
  const r = parseMukkebiOrders([['주문일시', '메뉴']]);
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0], /주문번호/);
});

test('리뷰 파일 파싱', () => {
  const r = parseMukkebiReviews(parseCsv('작성일시,별점,리뷰내용,사장님 댓글\n2026-11-01 20:00,★2,식었어요,죄송합니다\n'));
  assert.equal(r.rows[0].rating, 2);
  assert.equal(r.rows[0].reply?.content, '죄송합니다');
});

/** 테스트용 최소 XLSX(무압축 ZIP) 만들기 */
function makeXlsx(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('XLSX: 공유 문자열·숫자·엑셀 날짜 셀을 읽고 주문으로 변환', () => {
  const shared = ['주문일시', '주문번호', '주문금액', '중개수수료', 'X1', '배달완료', '주문상태', '치킨 &amp; 콜라', '주문메뉴'];
  const sst = `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>6</v></c><c r="F1" t="s"><v>8</v></c></row>
    <row r="2"><c r="A2"><v>46346.5</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>23000</v></c><c r="D2"><v>460</v></c><c r="E2" t="s"><v>5</v></c><c r="F2" t="s"><v>7</v></c></row>
  </sheetData></worksheet>`;
  const buf = makeXlsx({ 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet });
  const rows = readXlsx(buf);
  assert.equal(rows[1][5], '치킨 & 콜라');
  const { rows: out, errors } = parseMukkebiOrders(rows);
  assert.deepEqual(errors, []);
  assert.equal(out[0].order.orderedAt, '2026-11-20T12:00:00+09:00');
  assert.equal(out[0].order.orderAmount, 23000);
  assert.equal(out[0].commissionFee, 460);
});

test('어댑터: 가져온 파일이 있으면 샘플 대신 파일 데이터를 쓰고, 주문번호 중복은 제거', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mkb-'));
  try {
    const csv = readFileSync(SAMPLE);
    writeFileSync(join(dir, 'a.csv'), csv);
    writeFileSync(join(dir, 'b.csv'), csv); // 같은 파일 두 번
    const a = new MukkebiAdapter({ importDir: dir, mock: true });
    assert.equal((await a.verifyAccount()).source, 'import');
    const orders = await a.getOrders({ from: '2026-11-17', to: '2026-11-23' });
    assert.equal(orders.length, parseMukkebiOrders(parseCsv(csv.toString('utf8'))).rows.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
