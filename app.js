/* UI for the on-call planner. Needs jalali.js and scheduler.js. */
(function () {
  'use strict';
  var J = Jalali, S = Scheduler, fa = J.fa;
  var KEY = 'shiftPlanner.v1';
  var MIN_H = 0.25, MAX_H = 5;
  var app = document.getElementById('app');
  var state, result = null;

  function $(sel, rootEl) { return (rootEl || document).querySelector(sel); }
  function $all(sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); }
  function num(x) { return fa(String(Math.round(x * 100) / 100)); }
  function round2(x) { return Math.round(x * 100) / 100; }

  /* ---------- state ---------- */
  function defaults() {
    var t = J.today(), d = { y: t.jy, m: t.jm, d: t.jd };
    return {
      step: 1, start: d, end: { y: d.y, m: d.m, d: d.d }, mode: 'night',
      total: '', max: '', small: 'equal', dayBase: 0.75,
      brush: { active: 'hard', easy: 0.75, hard: 1.5, vhard: 2, custom: 1.25 },
      overrides: {}, seed: 1
    };
  }
  function load() {
    var s = defaults();
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') {
        Object.keys(s).forEach(function (k) {
          if (raw[k] === undefined || raw[k] === null) return;
          if (k === 'brush') Object.keys(s.brush).forEach(function (b) { if (raw.brush[b] != null) s.brush[b] = raw.brush[b]; });
          else s[k] = raw[k];
        });
        if (!J.isValid(s.start.y, s.start.m, s.start.d) || !J.isValid(s.end.y, s.end.m, s.end.d)) {
          var d = defaults(); s.start = d.start; s.end = d.end;
        }
      }
    } catch (e) { s = defaults(); }
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage may be blocked */ } }

  /* ---------- derived values ---------- */
  function jdnOf(d) { return J.toJdn(d.y, d.m, d.d); }
  function isBoth() { return state.mode === 'both'; }
  function baseOf(kind) { return kind === 'd' ? state.dayBase : 1; }
  function valOf(jdn, kind) {
    var v = state.overrides[jdn + kind];
    return v == null ? baseOf(kind) : v;
  }
  function setVal(jdn, kind, v) {
    v = round2(v);
    if (Math.abs(v - baseOf(kind)) < 1e-9) delete state.overrides[jdn + kind];
    else state.overrides[jdn + kind] = v;
  }
  function slots() {
    var out = [], a = jdnOf(state.start), b = jdnOf(state.end), both = isBoth();
    for (var j = a; j <= b; j++) {
      if (both) out.push({ jdn: j, kind: 'd' });
      out.push({ jdn: j, kind: 'n' });
    }
    return out;
  }
  function totals() {
    var t = { points: 0, harder: 0, easier: 0, count: 0 };
    slots().forEach(function (s) {
      var v = valOf(s.jdn, s.kind), b = baseOf(s.kind);
      t.points += v; t.count++;
      if (v > b + 1e-9) t.harder++; else if (v < b - 1e-9) t.easier++;
    });
    return t;
  }

  function checkStep1() {
    var e = {}, a = jdnOf(state.start), b = jdnOf(state.end);
    if (b < a) e.end = 'تاریخ پایان نباید قبل از تاریخ شروع باشد.';
    else if (b - a + 1 > 366) e.end = 'بازه نباید بیشتر از ۳۶۶ روز باشد. الان ' + fa(b - a + 1) + ' روز است.';
    return e;
  }
  function intField(str, name) {
    if (String(str).trim() === '') return { err: 'لطفاً ' + name + ' را بنویسید.' };
    var n = J.parseNum(str);
    if (isNaN(n) || n !== Math.floor(n) || n < 1) return { err: 'یک عدد صحیح، ۱ یا بیشتر بنویسید.' };
    return { n: n };
  }
  function groupsInfo() {
    var t = intField(state.total, 'تعداد کل اینترن‌ها'), m = intField(state.max, 'حداکثر نفر در هر گروه');
    var info = { errors: {}, ok: false };
    if (t.err) info.errors.total = t.err;
    if (m.err) info.errors.max = m.err;
    if (t.err || m.err) return info;
    if (t.n > 100000) { info.errors.total = 'این عدد خیلی بزرگ است.'; return info; }
    var G = Math.ceil(t.n / m.n);
    if (G > S.MAX_GROUPS) {
      info.errors.max = 'با این عددها ' + fa(G) + ' گروه ساخته می‌شود، ولی حداکثر ' + fa(S.MAX_GROUPS) +
        ' گروه ممکن است. «حداکثر اینترن در هر گروه» را بیشتر کنید.';
      return info;
    }
    info.ok = true; info.total = t.n; info.max = m.n; info.G = G;
    info.sizes = S.groupSizes(t.n, m.n);
    info.differ = info.sizes[0] !== info.sizes[G - 1];
    return info;
  }
  function groupsText(info) {
    var parts = [], i = 0;
    while (i < info.G) {
      var j = i;
      while (j < info.G && info.sizes[j] === info.sizes[i]) j++;
      parts.push(fa(j - i) + ' گروه ' + fa(info.sizes[i]) + ' نفره (' + S.LABELS.slice(i, j).join('، ') + ')');
      i = j;
    }
    return fa(info.G) + ' گروه تشکیل می‌شود: ' + parts.join(' و ');
  }
  function hardField(str) {
    var n = J.parseNum(str);
    if (isNaN(n) || n < MIN_H || n > MAX_H) return { err: 'عددی بین ۰٫۲۵ تا ۵ بنویسید.' };
    return { n: round2(n) };
  }

  /* ---------- small html helpers ---------- */
  function progress() {
    if (state.step > 3) return '<div class="progress"><div class="label">' +
      (state.step === 4 ? 'خلاصه — همه مرحله‌ها کامل شد' : 'نتیجه') + '</div><div class="bar"><i style="width:100%"></i></div></div>';
    return '<div class="progress"><div class="label">مرحله ' + fa(state.step) + ' از ۳</div>' +
      '<div class="bar"><i style="width:' + Math.round(state.step / 3 * 100) + '%"></i></div></div>';
  }
  function nav(nextLabel) {
    return '<div class="nav">' +
      (state.step > 1 ? '<button type="button" class="btn" id="prev">قبلی</button>' : '') +
      (nextLabel ? '<button type="button" class="btn primary" id="next">' + nextLabel + '</button>' : '') + '</div>';
  }
  function go(step) {
    state.step = step; save(); render();
    window.scrollTo(0, 0);
  }
  function bindNav(validate) {
    var p = $('#prev'), n = $('#next');
    if (p) p.onclick = function () { go(state.step - 1); };
    if (n) n.onclick = function () { if (!validate || validate()) go(state.step + 1); };
  }

  /* ---------- step 1 ---------- */
  function dateSelects(id, d) {
    var t = J.today(), y, i, h = '<div class="date3">';
    var len = J.monthLength(d.y, d.m);
    h += '<select id="' + id + 'D" aria-label="روز">';
    for (i = 1; i <= len; i++) h += '<option value="' + i + '"' + (i === d.d ? ' selected' : '') + '>' + fa(i) + '</option>';
    h += '</select><select id="' + id + 'M" aria-label="ماه">';
    for (i = 1; i <= 12; i++) h += '<option value="' + i + '"' + (i === d.m ? ' selected' : '') + '>' + J.MONTHS[i - 1] + '</option>';
    h += '</select><select id="' + id + 'Y" aria-label="سال">';
    var lo = Math.min(t.jy - 1, state.start.y, state.end.y), hi = Math.max(t.jy + 3, state.start.y, state.end.y);
    for (y = lo; y <= hi; y++) h += '<option value="' + y + '"' + (y === d.y ? ' selected' : '') + '>' + fa(y) + '</option>';
    return h + '</select></div>';
  }
  function renderStep1() {
    app.innerHTML = progress() +
      '<section class="card"><h2>بازه و نوع کشیک</h2>' +
      '<div class="field"><span class="flabel">تاریخ شروع</span>' + dateSelects('start', state.start) +
      '<p class="hint">اولین روزی که کشیک دارد (روز / ماه / سال شمسی).</p></div>' +
      '<div class="field"><span class="flabel">تاریخ پایان</span>' + dateSelects('end', state.end) +
      '<p class="hint">آخرین روزی که کشیک دارد. خود این روز هم حساب می‌شود. حداکثر ۳۶۶ روز.</p>' +
      '<p class="error" id="errEnd"></p><p class="hint" id="rangeInfo"></p></div>' +
      '<div class="field"><span class="flabel">نوع کشیک</span>' +
      '<label class="radio"><input type="radio" name="mode" value="night"' + (isBoth() ? '' : ' checked') + '>فقط کشیک شب — هر روز یک گروه</label>' +
      '<label class="radio"><input type="radio" name="mode" value="both"' + (isBoth() ? ' checked' : '') + '>کشیک روز و شب — هر روز دو گروه (یکی روز، یکی شب)</label>' +
      '<p class="hint">اگر در بخش شما کشیک روز جدا از کشیک شب است، گزینه دوم را بزنید.</p></div>' +
      '</section>' + nav('بعدی');

    function show() {
      var e = checkStep1();
      $('#errEnd').textContent = e.end || '';
      $('#rangeInfo').textContent = e.end ? '' : 'طول بازه: ' + fa(jdnOf(state.end) - jdnOf(state.start) + 1) + ' روز';
      return !e.end;
    }
    ['start', 'end'].forEach(function (id) {
      ['D', 'M', 'Y'].forEach(function (p) {
        $('#' + id + p).onchange = function () {
          var d = state[id];
          d.y = +$('#' + id + 'Y').value; d.m = +$('#' + id + 'M').value; d.d = +$('#' + id + 'D').value;
          var len = J.monthLength(d.y, d.m);
          if (d.d > len) d.d = len;
          save();
          if (p !== 'D') { renderStep1(); } else show();
        };
      });
    });
    $all('input[name=mode]').forEach(function (r) {
      r.onchange = function () { state.mode = r.value; save(); };
    });
    show();
    bindNav(show);
  }

  /* ---------- step 2 ---------- */
  function renderStep2() {
    app.innerHTML = progress() +
      '<section class="card"><h2>اینترن‌ها و گروه‌ها</h2>' +
      '<div class="field"><label for="total">تعداد کل اینترن‌ها</label>' +
      '<input id="total" type="text" inputmode="numeric" autocomplete="off">' +
      '<p class="hint">همه اینترن‌هایی که در این بازه کشیک می‌دهند. مثلاً ۲۳</p><p class="error" id="errTotal"></p></div>' +
      '<div class="field"><label for="max">حداکثر اینترن در هر گروه</label>' +
      '<input id="max" type="text" inputmode="numeric" autocomplete="off">' +
      '<p class="hint">هر کشیک را یک گروه کامل با هم می‌دهد. مثلاً ۵</p><p class="error" id="errMax"></p></div>' +
      '</section><div id="live2"></div>' + nav('بعدی');
    $('#total').value = state.total; $('#max').value = state.max;

    function live(force) {
      var info = groupsInfo(), h = '';
      ['total', 'max'].forEach(function (f) {
        var showErr = info.errors[f] && (force || String(state[f]).trim() !== '');
        $('#err' + (f === 'total' ? 'Total' : 'Max')).textContent = showErr ? info.errors[f] : '';
        $('#' + f).classList.toggle('bad', !!showErr);
      });
      if (info.ok) {
        h += '<div class="box" id="groupBox">' + groupsText(info) + '</div>';
        if (info.differ) {
          h += '<section class="card"><div class="field"><span class="flabel">گروه‌های کم‌نفرتر</span>' +
            '<label class="radio"><input type="radio" name="small" value="equal"' + (state.small === 'prop' ? '' : ' checked') + '>همان سهم کار بقیه</label>' +
            '<label class="radio"><input type="radio" name="small" value="prop"' + (state.small === 'prop' ? ' checked' : '') + '>سهم کمتر، به نسبت تعداد نفرات</label>' +
            '<p class="hint">گزینه اول: همه گروه‌ها به یک اندازه کشیک می‌دهند. گزینه دوم: گروهی که نفر کمتری دارد، کمی کمتر کشیک می‌دهد.</p></div></section>';
        }
        if (info.G === 1) h += '<div class="warn">توجه: فقط یک گروه ساخته می‌شود و همه کشیک‌ها به همان گروه می‌رسد.</div>';
        else if (isBoth() && info.G < 3) h += '<div class="warn">توجه: با ۲ گروه و کشیک روز و شب، هر گروه یکی در میان کشیک دارد و استراحت خیلی کوتاه می‌شود. بهتر است دست‌کم ۳ گروه باشد.</div>';
      } else h = '<div id="groupBox" class="box"></div>';
      $('#live2').innerHTML = h;
      $all('input[name=small]').forEach(function (r) { r.onchange = function () { state.small = r.value; save(); }; });
      return info.ok;
    }
    ['total', 'max'].forEach(function (f) {
      $('#' + f).oninput = function () { state[f] = this.value; save(); live(false); };
    });
    live(false);
    bindNav(function () { return live(true); });
  }

  /* ---------- step 3 ---------- */
  function shade(v, base) {
    var d = v - base, t, L;
    if (Math.abs(d) < 1e-9) return '';
    if (d > 0) {
      t = Math.min(1, d / 2.5); L = 88 - 46 * t;
      return 'background:hsl(4,72%,' + L + '%);border-color:hsl(4,60%,' + (L - 12) + '%);' + (L < 62 ? 'color:#fff;' : '');
    }
    t = Math.min(1, -d / 0.75); L = 88 - 38 * t;
    return 'background:hsl(140,45%,' + L + '%);border-color:hsl(140,40%,' + (L - 14) + '%);' + (L < 58 ? 'color:#fff;' : '');
  }
  function shiftInner(jdn, kind) {
    return (isBoth() ? '<span class="sk">' + (kind === 'd' ? 'روز' : 'شب') + '</span>' : '') +
      '<span class="sv">' + num(valOf(jdn, kind)) + '</span>';
  }
  function shiftBtn(jdn, kind) {
    var v = valOf(jdn, kind);
    return '<button type="button" class="shift" data-j="' + jdn + '" data-k="' + kind + '" style="' + shade(v, baseOf(kind)) +
      '" aria-label="' + J.formatJdn(jdn) + (isBoth() ? (kind === 'd' ? ' روز' : ' شب') : '') + ' سختی ' + num(v) + '">' +
      shiftInner(jdn, kind) + '</button>';
  }
  function calendarHtml() {
    var a = jdnOf(state.start), b = jdnOf(state.end), h = '', cur = null, j, d, i, both = isBoth();
    for (j = a; j <= b; j++) {
      d = J.fromJdn(j);
      if (!cur || cur.jy !== d.jy || cur.jm !== d.jm) {
        if (cur) h += '</div></div>';
        cur = d;
        h += '<div class="month"><h3>' + J.MONTHS[d.jm - 1] + ' ' + fa(d.jy) + '</h3><div class="grid">';
        for (i = 0; i < 7; i++) h += '<div class="wd">' + J.WEEKDAYS_SHORT[i] + '</div>';
        for (i = 0; i < J.weekday(j); i++) h += '<div></div>';
      }
      h += '<div class="cell' + (J.weekday(j) === 6 ? ' fri' : '') + '"><div class="dnum">' + fa(d.jd) + '</div>' +
        (both ? shiftBtn(j, 'd') : '') + shiftBtn(j, 'n') + '</div>';
    }
    return h + (cur ? '</div></div>' : '');
  }
  function brushLabel(b) {
    var br = state.brush;
    if (b === 'easy') return 'آسان ' + num(br.easy);
    if (b === 'normal') return 'عادی';
    if (b === 'hard') return 'سخت ' + num(br.hard);
    if (b === 'vhard') return 'خیلی سخت ' + num(br.vhard);
    if (b === 'custom') return 'دلخواه';
    return '✎ عدد دقیق';
  }
  function renderStep3() {
    var both = isBoth(), br = state.brush;
    var h = progress() +
      '<section class="card"><h2>سختی هر کشیک</h2>' +
      '<p>هر کشیک یک عدد «سختی» دارد. کشیک شبِ معمولی ۱ است. عدد بزرگ‌تر یعنی کشیک سخت‌تر (مثلاً جمعه یا تعطیلی) و عدد کوچک‌تر یعنی کشیک آسان‌تر. ' +
      'کشیک سخت‌تر امتیاز بیشتری دارد و برنامه طوری چیده می‌شود که جمع امتیاز گروه‌ها نزدیک به هم باشد.</p>' +
      '<p class="hint">روش کار: اول یکی از دکمه‌های نوار بالا را بزنید (مثلاً «سخت»)، بعد روی کشیک‌های موردنظر بزنید. ' +
      'اگر دوباره روی همان کشیک بزنید به مقدار اولیه برمی‌گردد. برای نوشتن عدد دقیقِ یک کشیک، انگشت را روی آن نگه دارید یا «✎ عدد دقیق» را بزنید.</p>' +
      '</section>';
    if (both) {
      h += '<section class="card"><div class="field"><label for="dayBase">ضریب پایه کشیک روز</label>' +
        '<input id="dayBase" type="text" inputmode="decimal" autocomplete="off" value="' + num(state.dayBase) + '">' +
        '<p class="hint">یک کشیک روز چند برابر یک کشیک شب سختی دارد؟</p><p class="error" id="errDayBase"></p></div></section>';
    }
    h += '<div class="brushbar"><div class="chips">';
    ['easy', 'normal', 'hard', 'vhard', 'custom', 'edit'].forEach(function (b) {
      h += '<button type="button" class="chip' + (br.active === b ? ' on' : '') + '" data-brush="' + b + '">' + brushLabel(b) + '</button>';
    });
    h += '</div><div class="custom" id="customRow"' + (br.active === 'custom' ? '' : ' hidden') + '>' +
      '<button type="button" class="pm" id="cPlus" aria-label="بیشتر">+</button>' +
      '<input id="customVal" type="text" inputmode="decimal" autocomplete="off" aria-label="مقدار دلخواه" value="' + num(br.custom) + '">' +
      '<button type="button" class="pm" id="cMinus" aria-label="کمتر">−</button>' +
      '<span class="hint">از ۰٫۲۵ تا ۵</span></div>' +
      '<div class="live" id="live3"></div></div>' +
      '<details class="card"><summary>تنظیم مقدارها</summary><div class="three">' +
      '<div><label for="bEasy">آسان</label><input id="bEasy" type="text" inputmode="decimal" value="' + num(br.easy) + '"></div>' +
      '<div><label for="bHard">سخت</label><input id="bHard" type="text" inputmode="decimal" value="' + num(br.hard) + '"></div>' +
      '<div><label for="bVhard">خیلی سخت</label><input id="bVhard" type="text" inputmode="decimal" value="' + num(br.vhard) + '"></div>' +
      '</div><p class="hint">عدد هر دکمه را می‌توانید عوض کنید (بین ۰٫۲۵ تا ۵). «عادی» یعنی مقدار اولیه همان کشیک.</p><p class="error" id="errBrush"></p></details>' +
      '<div id="cal">' + calendarHtml() + '</div>' +
      '<button type="button" class="btn danger wide" id="clearAll">پاک کردن همه</button>' +
      '<p class="hint" style="margin-bottom:12px">همه کشیک‌ها را به مقدار اولیه برمی‌گرداند.</p>' +
      nav('بعدی');
    app.innerHTML = h;

    function live() {
      var t = totals();
      $('#live3').textContent = 'مجموع امتیاز: ' + num(t.points) + ' — سخت‌تر: ' + fa(t.harder) + ' کشیک — آسان‌تر: ' + fa(t.easier) + ' کشیک';
    }
    function refreshBtn(btn) {
      var j = +btn.dataset.j, k = btn.dataset.k, v = valOf(j, k);
      btn.setAttribute('style', shade(v, baseOf(k)));
      btn.innerHTML = shiftInner(j, k);
    }
    function setBrush(b) {
      br.active = b; save();
      $all('.chip').forEach(function (c) { c.classList.toggle('on', c.dataset.brush === b); });
      $('#customRow').hidden = b !== 'custom';
    }
    function apply(btn) {
      var j = +btn.dataset.j, k = btn.dataset.k, base = baseOf(k);
      if (br.active === 'edit') { openPanel(j, k, function () { refreshBtn(btn); live(); }); return; }
      var v = br.active === 'normal' ? base : br[br.active];
      if (Math.abs(valOf(j, k) - v) < 1e-9) v = base;
      setVal(j, k, v); save(); refreshBtn(btn); live();
    }

    $all('.chip').forEach(function (c) { c.onclick = function () { setBrush(c.dataset.brush); }; });
    function setCustom(v) {
      br.custom = Math.min(MAX_H, Math.max(MIN_H, round2(v)));
      $('#customVal').value = num(br.custom); save();
    }
    $('#cPlus').onclick = function () { setCustom(Math.floor(br.custom / 0.25 + 1e-9) * 0.25 + 0.25); };
    $('#cMinus').onclick = function () { setCustom(Math.ceil(br.custom / 0.25 - 1e-9) * 0.25 - 0.25); };
    $('#customVal').onchange = function () {
      var r = hardField(this.value);
      setCustom(r.err ? br.custom : r.n);
    };
    [['bEasy', 'easy'], ['bHard', 'hard'], ['bVhard', 'vhard']].forEach(function (p) {
      $('#' + p[0]).oninput = function () {
        var r = hardField(this.value);
        this.classList.toggle('bad', !!r.err);
        $('#errBrush').textContent = $all('.three .bad').length ? 'عددی بین ۰٫۲۵ تا ۵ بنویسید.' : '';
        if (r.err) return;
        br[p[1]] = r.n; save();
        $('[data-brush=' + p[1] + ']').textContent = brushLabel(p[1]);
      };
    });
    if (both) {
      $('#dayBase').oninput = function () {
        var r = hardField(this.value);
        $('#errDayBase').textContent = r.err || '';
        this.classList.toggle('bad', !!r.err);
        if (r.err) return;
        state.dayBase = r.n;
        // an edited value that now equals the new base is no longer an edit
        Object.keys(state.overrides).forEach(function (k) {
          if (k.slice(-1) === 'd' && Math.abs(state.overrides[k] - r.n) < 1e-9) delete state.overrides[k];
        });
        save();
        $('#cal').innerHTML = calendarHtml(); live();
      };
    }

    // tap = apply brush, long-press = exact value
    var cal = $('#cal'), timer = null, fired = false, sx = 0, sy = 0;
    function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
    cal.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('.shift');
      if (!btn) return;
      fired = false; sx = e.clientX; sy = e.clientY; cancel();
      timer = setTimeout(function () {
        timer = null; fired = true;
        openPanel(+btn.dataset.j, btn.dataset.k, function () { refreshBtn(btn); live(); });
      }, 550);
    });
    cal.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { cal.addEventListener(ev, cancel); });
    cal.addEventListener('contextmenu', function (e) { if (e.target.closest('.shift')) e.preventDefault(); });
    cal.addEventListener('click', function (e) {
      var btn = e.target.closest('.shift');
      if (!btn) return;
      if (fired) { fired = false; return; }
      apply(btn);
    });

    $('#clearAll').onclick = function () {
      if (!confirm('همه کشیک‌ها به مقدار اولیه برگردند؟')) return;
      state.overrides = {}; save();
      $('#cal').innerHTML = calendarHtml(); live();
    };
    live();
    bindNav(function () {
      if (both && hardField($('#dayBase').value).err) {
        $('#errDayBase').textContent = 'عددی بین ۰٫۲۵ تا ۵ بنویسید.';
        $('#dayBase').scrollIntoView({ block: 'center' });
        return false;
      }
      return true;
    });
  }

  /* ---------- exact value panel ---------- */
  var panelCtx = null;
  function slotName(jdn, kind) {
    return J.WEEKDAYS[J.weekday(jdn)] + ' ' + J.formatJdn(jdn) + (isBoth() ? ' — ' + (kind === 'd' ? 'روز' : 'شب') : '');
  }
  function openPanel(jdn, kind, done) {
    panelCtx = { jdn: jdn, kind: kind, done: done };
    $('#panelTitle').textContent = slotName(jdn, kind);
    $('#panelInput').value = num(valOf(jdn, kind));
    $('#panelErr').textContent = '';
    $('#panel').hidden = false;
    $('#panelInput').focus(); $('#panelInput').select();
  }
  function closePanel(changed) {
    $('#panel').hidden = true;
    var c = panelCtx; panelCtx = null;
    if (changed && c) { save(); c.done(); }
  }
  $('#panelOk').onclick = function () {
    var r = hardField($('#panelInput').value);
    if (r.err) { $('#panelErr').textContent = r.err; return; }
    setVal(panelCtx.jdn, panelCtx.kind, r.n); closePanel(true);
  };
  $('#panelInput').onkeydown = function (e) { if (e.key === 'Enter') $('#panelOk').onclick(); };
  $('#panelReset').onclick = function () { delete state.overrides[panelCtx.jdn + panelCtx.kind]; closePanel(true); };
  $('#panelCancel').onclick = function () { closePanel(false); };
  $('#panel').onclick = function (e) { if (e.target === this) closePanel(false); };

  /* ---------- summary ---------- */
  function rangeText() {
    return J.format(state.start.y, state.start.m, state.start.d) + ' تا ' + J.format(state.end.y, state.end.m, state.end.d);
  }
  function renderSummary() {
    var info = groupsInfo(), t = totals(), days = jdnOf(state.end) - jdnOf(state.start) + 1;
    var li = [
      '<b>بازه:</b> ' + rangeText() + ' (' + fa(days) + ' روز)',
      '<b>نوع کشیک:</b> ' + (isBoth() ? 'روز و شب — هر روز دو گروه' : 'فقط شب — هر روز یک گروه'),
      '<b>تعداد کشیک‌ها:</b> ' + fa(t.count),
      '<b>اینترن‌ها:</b> ' + fa(info.total) + ' نفر، حداکثر ' + fa(info.max) + ' نفر در هر گروه',
      '<b>گروه‌ها:</b> ' + groupsText(info)
    ];
    if (info.differ) li.push('<b>گروه‌های کم‌نفرتر:</b> ' + (state.small === 'prop' ? 'سهم کمتر، به نسبت تعداد نفرات' : 'همان سهم کار بقیه'));
    if (isBoth()) li.push('<b>ضریب پایه کشیک روز:</b> ' + num(state.dayBase));
    li.push('<b>سختی‌ها:</b> ' + fa(t.harder) + ' کشیک سخت‌تر، ' + fa(t.easier) + ' کشیک آسان‌تر، مجموع ' + num(t.points) + ' امتیاز');
    app.innerHTML = progress() + '<section class="card"><h2>خلاصه ورودی‌ها</h2><ul class="sumlist"><li>' +
      li.join('</li><li>') + '</li></ul></section>' +
      '<button type="button" class="btn primary big" id="build">ساخت برنامه</button>' +
      '<p class="hint" style="margin:6px 4px 12px">اگر چیزی اشتباه است با «قبلی» برگردید و درستش کنید.</p>' + nav('');
    bindNav();
    $('#build').onclick = function () {
      this.textContent = 'در حال ساخت…'; this.disabled = true;
      setTimeout(function () { go(5); }, 30);
    };
  }

  /* ---------- results ---------- */
  function compute() {
    var info = groupsInfo(), sl = slots();
    var res = S.schedule({
      weights: sl.map(function (s) { return valOf(s.jdn, s.kind); }),
      bases: sl.map(function (s) { return baseOf(s.kind); }),
      sizes: info.sizes, proportional: info.differ && state.small === 'prop', seed: state.seed
    });
    return { res: res, slots: sl, info: info };
  }
  function titleLine() { return 'برنامه کشیک ' + rangeText() + ' — ' + fa(result.info.G) + ' گروه'; }
  function shiftLine(s) {
    return J.WEEKDAYS[J.weekday(s.jdn)] + ' ' + J.formatJdn(s.jdn) + (isBoth() ? ' — ' + (s.kind === 'd' ? 'روز' : 'شب') : '') +
      ' — سختی ' + num(valOf(s.jdn, s.kind));
  }
  function statsLine(g) {
    return 'تعداد کشیک: ' + fa(g.count) + ' — سخت‌تر: ' + fa(g.harder) + '، عادی: ' + fa(g.normal) + '، آسان‌تر: ' + fa(g.easier) +
      ' — مجموع امتیاز: ' + num(g.points);
  }
  function plainText() {
    var out = [titleLine(), ''];
    result.res.groups.forEach(function (g) {
      out.push('گروه ' + g.label + ' — ' + fa(g.size) + ' نفر');
      g.slots.forEach(function (i) { out.push(shiftLine(result.slots[i])); });
      if (!g.slots.length) out.push('بدون کشیک');
      out.push(statsLine(g)); out.push('');
    });
    return out.join('\n').trim() + '\n';
  }
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement('textarea'), okc = false;
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;right:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      try { okc = document.execCommand('copy'); } catch (e) { okc = false; }
      document.body.removeChild(ta); done(okc);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }
  function renderResult() {
    result = compute();
    var res = result.res, sl = result.slots, both = isBoth(), h = progress();
    h += '<section class="card"><p class="title-line">' + titleLine() + '</p></section>';
    if (res.violations) h += '<div class="warn">با این ورودی‌ها نشد همه استراحت‌ها رعایت شود. «چیدمان دیگر» را امتحان کنید.</div>';
    h += '<button type="button" class="btn primary wide" id="copy">کپی متن برای تلگرام/واتساپ</button>' +
      '<div class="row" style="margin-bottom:12px"><button type="button" class="btn" id="edit">ویرایش ورودی‌ها</button>' +
      '<button type="button" class="btn" id="again">چیدمان دیگر</button></div>';

    res.groups.forEach(function (g) {
      h += '<section class="card group-card"><h3>گروه ' + g.label + ' — ' + fa(g.size) + ' نفر</h3><ul>';
      g.slots.forEach(function (i) {
        var s = sl[i], v = valOf(s.jdn, s.kind), b = baseOf(s.kind);
        h += '<li' + (v > b + 1e-9 ? ' class="h"' : v < b - 1e-9 ? ' class="e"' : '') + '>' + shiftLine(s) + '</li>';
      });
      if (!g.slots.length) h += '<li>بدون کشیک</li>';
      h += '</ul><p class="stats">' + statsLine(g) + '</p></section>';
    });

    h += '<section class="card"><h2>مقایسه عدالت بین گروه‌ها</h2><div class="tablewrap"><table><thead><tr>' +
      '<th>گروه</th><th>نفر</th><th>کشیک</th><th>سخت‌تر</th><th>عادی</th><th>آسان‌تر</th><th>امتیاز</th><th>هدف</th></tr></thead><tbody>';
    res.groups.forEach(function (g) {
      h += '<tr><td>' + g.label + '</td><td>' + fa(g.size) + '</td><td>' + fa(g.count) + '</td><td>' + fa(g.harder) + '</td><td>' +
        fa(g.normal) + '</td><td>' + fa(g.easier) + '</td><td><b>' + num(g.points) + '</b></td><td>' + num(g.target) + '</td></tr>';
    });
    h += '</tbody></table></div><p class="hint">«سخت‌تر» یعنی بالاتر از مقدار اولیه همان کشیک و «آسان‌تر» یعنی پایین‌تر از آن. «هدف» امتیازی است که سهم عادلانه آن گروه است.</p>' +
      '<p style="margin-top:6px">گروه‌هایی که تعداد کشیک کمتری دارند، کشیک‌های سخت‌تری گرفته‌اند تا جمع امتیاز همه گروه‌ها تا جای ممکن به سهمشان نزدیک باشد.</p></section>';

    h += '<section class="card"><h2>برنامه روز به روز</h2><div class="tablewrap"><table><thead><tr><th>تاریخ</th><th>روز هفته</th>' +
      (both ? '<th>گروه روز</th><th>گروه شب</th>' : '<th>گروه</th>') + '</tr></thead><tbody>';
    for (var i = 0; i < sl.length; i += both ? 2 : 1) {
      h += '<tr><td>' + J.formatJdn(sl[i].jdn) + '</td><td>' + J.WEEKDAYS[J.weekday(sl[i].jdn)] + '</td><td>' + S.LABELS[res.assignment[i]] + '</td>' +
        (both ? '<td>' + S.LABELS[res.assignment[i + 1]] + '</td>' : '') + '</tr>';
    }
    h += '</tbody></table></div></section>';
    app.innerHTML = h;

    $('#copy').onclick = function () {
      var btn = this;
      copyText(plainText(), function (okc) {
        btn.textContent = okc ? 'کپی شد ✓' : 'کپی نشد — دوباره بزنید';
        setTimeout(function () { btn.textContent = 'کپی متن برای تلگرام/واتساپ'; }, 2500);
      });
    };
    $('#edit').onclick = function () { go(1); };
    $('#again').onclick = function () { state.seed = (state.seed | 0) + 1; go(5); };
  }

  /* ---------- router ---------- */
  function render() {
    // never show a later screen while an earlier one is invalid
    if (state.step > 1 && checkStep1().end) state.step = 1;
    if (state.step > 2 && !groupsInfo().ok) state.step = 2;
    if (state.step === 1) renderStep1();
    else if (state.step === 2) renderStep2();
    else if (state.step === 3) renderStep3();
    else if (state.step === 4) renderSummary();
    else renderResult();
  }

  $('#resetAll').onclick = function () {
    if (!confirm('همه چیز پاک شود و از اول شروع کنید؟')) return;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    state = defaults(); result = null; save(); render(); window.scrollTo(0, 0);
  };

  state = load();
  render();
})();
