/* Run with: node tests/run.js */
'use strict';
var path = require('path');
var J = require('../jalali.js');
var S = require('../scheduler.js');

var failed = 0, passed = 0;
function ok(cond, msg) {
  if (cond) passed++;
  else { failed++; console.log('  FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

/* ---------- Jalali ---------- */
console.log('Jalali calendar');
eq(J.toGregorian(1403, 1, 1), { gy: 2024, gm: 3, gd: 20 }, '1403/01/01 = 2024-03-20');
eq(J.toGregorian(1404, 1, 1), { gy: 2025, gm: 3, gd: 21 }, '1404/01/01 = 2025-03-21');
eq(J.fromGregorian(2024, 3, 20), { jy: 1403, jm: 1, jd: 1 }, '2024-03-20 = 1403/01/01');
ok(J.isLeap(1403), '1403 is leap');
ok(J.isValid(1403, 12, 30), '1403/12/30 exists');
ok(!J.isValid(1404, 12, 30), '1404/12/30 does not exist');
eq(J.toJdn(1404, 1, 1) - J.toJdn(1403, 12, 30), 1, '1403/12/30 is followed by 1404/01/01');
eq(J.WEEKDAYS[J.weekday(J.toJdn(1403, 1, 1))], 'چهارشنبه', '1403/01/01 is a Wednesday');
eq(J.fa('1405/09/01'), '۱۴۰۵/۰۹/۰۱', 'Persian digits');
eq(J.parseNum('۱٫۵'), 1.5, 'parse Persian decimal');
eq(J.parseNum('23'), 23, 'parse English digits');
ok(isNaN(J.parseNum('abc')), 'reject non-number');

var intl = null;
try {
  intl = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  var probe = intl.formatToParts(new Date(Date.UTC(2024, 2, 20)));
  var py = +probe.filter(function (p) { return p.type === 'year'; })[0].value;
  if (py !== 1403) intl = null;
} catch (e) { intl = null; }

var days = 0, rtBad = 0, intlBad = 0, prev = null;
for (var y = 1390; y <= 1420; y++) {
  for (var m = 1; m <= 12; m++) {
    var len = J.monthLength(y, m);
    for (var d = 1; d <= len; d++) {
      var jdn = J.toJdn(y, m, d);
      if (prev !== null && jdn !== prev + 1) rtBad++;
      prev = jdn;
      var back = J.fromJdn(jdn);
      if (back.jy !== y || back.jm !== m || back.jd !== d) rtBad++;
      var g = J.toGregorian(y, m, d), b2 = J.fromGregorian(g.gy, g.gm, g.gd);
      if (b2.jy !== y || b2.jm !== m || b2.jd !== d) rtBad++;
      if (intl) {
        var parts = {};
        intl.formatToParts(new Date(Date.UTC(g.gy, g.gm - 1, g.gd))).forEach(function (p) { parts[p.type] = +p.value; });
        if (parts.year !== y || parts.month !== m || parts.day !== d) {
          if (intlBad < 3) console.log('  Intl mismatch at ' + y + '/' + m + '/' + d, parts);
          intlBad++;
        }
      }
      days++;
    }
  }
}
eq(rtBad, 0, 'round-trip every day 1390–1420 (' + days + ' days)');
if (intl) eq(intlBad, 0, 'cross-check with Intl persian calendar (' + days + ' days)');
else console.log('  (Intl persian calendar not available — cross-check skipped)');

/* ---------- Group sizes ---------- */
console.log('Group sizes');
eq(S.groupSizes(23, 5), [5, 5, 5, 4, 4], '23 & 5');
eq(S.groupSizes(20, 5), [5, 5, 5, 5], '20 & 5');
eq(S.groupSizes(11, 5), [4, 4, 3], '11 & 5');
eq(S.groupSizes(3, 5), [3], '3 & 5');
eq(S.LABELS.length, 32, '32 labels');

/* ---------- Scheduler ---------- */
console.log('Scheduler (random inputs)');
var VALUES = [0.5, 0.75, 1, 1.75, 3, 5];
var rnd = S.mulberry32(2024);
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

function makeCase(both, days, total, max, proportional, customRate, seed) {
  var sizes = S.groupSizes(total, max), w = [], bases = [];
  for (var i = 0; i < days; i++) {
    var kinds = both ? [0.75, 1] : [1];
    kinds.forEach(function (base) {
      bases.push(base);
      w.push(rnd() < customRate ? VALUES[ri(0, VALUES.length - 1)] : base);
    });
  }
  return { weights: w, bases: bases, sizes: sizes, proportional: proportional, seed: seed };
}

function check(input, name) {
  var t0 = Date.now(), res = S.schedule(input), ms = Date.now() - t0;
  var N = input.weights.length, G = input.sizes.length, i, g;
  var bad = [];
  // every slot assigned exactly once
  if (res.assignment.length !== N) bad.push('assignment length');
  var seen = new Array(N).fill(0), cnt = new Array(G).fill(0), pts = new Array(G).fill(0);
  res.groups.forEach(function (gr) { gr.slots.forEach(function (s) { seen[s]++; if (res.assignment[s] !== gr.index) bad.push('slot/group mismatch'); }); });
  for (i = 0; i < N; i++) {
    if (seen[i] !== 1) bad.push('slot ' + i + ' assigned ' + seen[i] + ' times');
    g = res.assignment[i];
    if (!(g >= 0 && g < G)) bad.push('bad group');
    cnt[g]++; pts[g] += input.weights[i];
  }
  // no back-to-back
  if (G >= 2) for (i = 1; i < N; i++) if (res.assignment[i] === res.assignment[i - 1]) bad.push('back-to-back at ' + i);
  if (res.violations !== 0) bad.push('violations reported');
  // counts within quotas
  var people = input.sizes.reduce(function (a, b) { return a + b; }, 0);
  for (g = 0; g < G; g++) {
    if (cnt[g] !== res.groups[g].count || cnt[g] !== res.groups[g].quota) bad.push('count != quota for group ' + g);
    if (Math.abs(pts[g] - res.groups[g].points) > 1e-6) bad.push('points wrong');
    var share = input.proportional ? input.sizes[g] / people : 1 / G;
    if (G >= 3 && Math.abs(cnt[g] - share * N) >= 1 + 1e-9 && cnt[g] < Math.ceil(N / 2)) bad.push('count far from share, group ' + g);
  }
  if (!input.proportional && Math.max.apply(null, cnt) - Math.min.apply(null, cnt) > 1) bad.push('equal mode counts differ by more than 1');
  // small points deviation: never more than a fraction of one hard shift
  // (G = 2 has only two legal layouts, so it is not checked)
  var maxW = Math.max.apply(null, input.weights);
  if (G >= 3 && N >= 4 * G && res.maxDeviation > Math.max(1, maxW * 0.75)) bad.push('points deviation too big: ' + res.maxDeviation.toFixed(2));
  ok(bad.length === 0, name + ': ' + bad.slice(0, 3).join('; '));
  return { res: res, ms: ms };
}

var worstDev = 0, worstMs = 0, cases = 0, sumDev = 0;
for (var t = 0; t < 160; t++) {
  var both = t % 2 === 1;
  var total = ri(1, 60), max = ri(1, 8);
  if (Math.ceil(total / max) > 32) max = Math.ceil(total / 32);
  var input = makeCase(both, ri(1, 120), total, max, t % 4 >= 2, [0, 0.15, 0.5, 1][ri(0, 3)], t + 1);
  var out = check(input, 'random #' + t + ' (' + (both ? 'day+night' : 'night') + ', N=' + input.weights.length + ', G=' + input.sizes.length + ')');
  if (input.sizes.length >= 3 && input.weights.length >= 4 * input.sizes.length) {
    worstDev = Math.max(worstDev, out.res.maxDeviation); sumDev += out.res.maxDeviation; cases++;
  }
  worstMs = Math.max(worstMs, out.ms);
}
console.log('  ' + cases + ' cases with G>=3: mean max-deviation ' + (sumDev / cases).toFixed(3) + ' points, worst ' + worstDev.toFixed(3) + '; slowest ' + worstMs + ' ms');

// determinism
var inA = makeCase(true, 30, 23, 5, false, 0.3, 7);
eq(S.schedule(inA).assignment, S.schedule(inA).assignment, 'same inputs give same result');
var inB = JSON.parse(JSON.stringify(inA)); inB.seed = 8;
ok(JSON.stringify(S.schedule(inA).assignment) !== JSON.stringify(S.schedule(inB).assignment), 'new seed gives another layout');

// biggest case: 366 days x 2 shifts x 32 groups
var bigIn = makeCase(true, 366, 160, 5, true, 0.3, 99);
var big = check(bigIn, 'big 366x2x32');
console.log('  biggest case (732 slots, 32 groups): ' + big.ms + ' ms, max deviation ' + big.res.maxDeviation.toFixed(3));
ok(big.ms < 2000, 'biggest case under 2 seconds (took ' + big.ms + ' ms)');

// sample fairness report
var sample = makeCase(true, 30, 23, 5, false, 0.3, 1);
var sres = check(sample, 'sample').res;
console.log('  Sample fairness report — 30 days, day+night, 23 interns, max 5 per group, equal share:');
console.log('  group size shifts harder normal easier points target minGap');
sres.groups.forEach(function (g) {
  console.log('  ' + [g.label, g.size, g.count, g.harder, g.normal, g.easier, g.points.toFixed(2), g.target.toFixed(2), g.minGap].join('\t'));
});

/* ---------- Browser smoke test (only if Playwright is available) ---------- */
async function browserTest() {
  var pw;
  try { pw = require('playwright'); } catch (e) { console.log('Browser test skipped (no headless browser)'); return; }
  console.log('Browser smoke test');
  var browser = await pw.chromium.launch();
  var ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1 });
  var page = await ctx.newPage();
  var errors = [], external = [];
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', function (e) { errors.push(String(e)); });
  page.on('request', function (r) { if (!/^(file|data|about):/.test(r.url())) external.push(r.url()); });
  page.on('dialog', function (d) { d.accept(); });
  var shotDir = process.env.SHOT_DIR;
  async function shot(n) { if (shotDir) await page.screenshot({ path: path.join(shotDir, n + '.png'), fullPage: true }); }
  try {
    await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
    await page.waitForSelector('#startD');
    // 30-day range starting today
    var t = J.today(), end = J.fromJdn(J.toJdn(t.jy, t.jm, t.jd) + 29);
    await page.selectOption('#endY', String(end.jy));
    await page.selectOption('#endM', String(end.jm));
    await page.selectOption('#endD', String(end.jd));
    await page.check('input[name=mode][value=both]');
    await shot('1-step1');
    await page.click('#next');
    await page.fill('#total', '۲۳');
    await page.fill('#max', '5');
    var box = await page.textContent('#groupBox');
    ok(/۵ گروه تشکیل می‌شود/.test(box) && /الف، ب، پ/.test(box), 'live group box: ' + box);
    await shot('2-step2');
    await page.click('#next');
    await page.waitForSelector('.shift');
    eq(await page.locator('.shift').count(), 60, '60 shift buttons');
    await page.click('[data-brush=vhard]');
    await page.locator('.shift').nth(3).click();
    await page.locator('.shift').nth(10).click();
    await page.click('[data-brush=easy]');
    await page.locator('.shift').nth(5).click();
    eq((await page.locator('.shift').nth(3).textContent()).replace(/\s/g, ''), 'شب۲', 'brush applied');
    await shot('3-step3');
    await page.click('#next');
    await shot('4-summary');
    await page.click('#build');
    await page.waitForSelector('.group-card');
    eq(await page.locator('.group-card').count(), 5, '5 group cards');
    await page.click('#copy');
    await page.waitForFunction(function () { return /کپی شد/.test(document.querySelector('#copy').textContent); });
    await shot('5-result');
    var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
    ok(overflow <= 0, 'no horizontal page scroll (overflow ' + overflow + 'px)');
    await page.click('#again');
    await page.waitForSelector('.group-card');
    // reload: inputs are remembered
    await page.reload();
    await page.waitForSelector('.group-card');
    await page.click('#edit');
    await page.waitForSelector('#startD');
    await page.click('#next');
    eq(await page.inputValue('#total'), '۲۳', 'inputs restored after reload');
    eq(external, [], 'no external requests');
    eq(errors, [], 'no console errors');
  } catch (e) {
    ok(false, 'browser test crashed: ' + e.message + (errors.length ? ' | console: ' + errors.join(' | ') : ''));
  }
  await browser.close();
}

browserTest().then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
