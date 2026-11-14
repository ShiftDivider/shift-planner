/* Jalali (Hijri Shamsi) <-> Gregorian conversion.
   Algorithm: the same one used by jalaali-js (Behrang Noruzi Niya / Borkowski). */
(function (root) {
  'use strict';

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  var BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function jalCal(jy) {
    var bl = BREAKS.length, gy = jy + 621, leapJ = -14, jp = BREAKS[0];
    var jm, jump = 0, leap, leapG, march, n, i;
    if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('Invalid Jalali year ' + jy);
    for (i = 1; i < bl; i += 1) {
      jm = BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
      div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j, i, gd, gm, gy;
    j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    i = div(mod(j, 1461), 4) * 5 + 308;
    gd = div(mod(i, 153), 5) + 1;
    gm = mod(div(i, 153), 12) + 1;
    gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  /* Jalali date -> Julian Day Number */
  function toJdn(jy, jm, jd) {
    var r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  /* Julian Day Number -> Jalali date */
  function fromJdn(jdn) {
    var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy);
    var jdn1f = g2d(gy, 3, r.march), jd, jm, k;
    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy: jy, jm: jm, jd: jd };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  function isLeap(jy) { return jalCal(jy).leap === 0; }

  function monthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isLeap(jy) ? 30 : 29;
  }

  function isValid(jy, jm, jd) {
    return jy >= -61 && jy < 3178 && jm >= 1 && jm <= 12 &&
      jd >= 1 && jd <= monthLength(jy, jm);
  }

  function toGregorian(jy, jm, jd) { return d2g(toJdn(jy, jm, jd)); }
  function fromGregorian(gy, gm, gd) { return fromJdn(g2d(gy, gm, gd)); }

  /* 0 = شنبه (Saturday) ... 6 = جمعه (Friday) */
  function weekday(jdn) { return mod(jdn + 2, 7); }

  function today() {
    var d = new Date();
    return fromGregorian(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  var WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  var FA = '۰۱۲۳۴۵۶۷۸۹';

  /* Latin digits -> Persian digits, "." -> "٫" */
  function fa(x) {
    return String(x).replace(/\d/g, function (d) { return FA[+d]; }).replace(/\./g, '٫');
  }

  /* Persian / Arabic / Latin digits -> number (NaN if not a plain number) */
  function parseNum(s) {
    s = String(s == null ? '' : s).trim()
      .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); })
      .replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[٫\/,،]/g, '.');
    if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* "۱۴۰۵/۰۹/۰۱" */
  function format(jy, jm, jd) { return fa(jy + '/' + pad2(jm) + '/' + pad2(jd)); }
  function formatJdn(jdn) { var j = fromJdn(jdn); return format(j.jy, j.jm, j.jd); }

  var api = {
    toJdn: toJdn, fromJdn: fromJdn, toGregorian: toGregorian, fromGregorian: fromGregorian,
    g2d: g2d, d2g: d2g, isLeap: isLeap, monthLength: monthLength, isValid: isValid,
    weekday: weekday, today: today, fa: fa, parseNum: parseNum,
    format: format, formatJdn: formatJdn,
    MONTHS: MONTHS, WEEKDAYS: WEEKDAYS, WEEKDAYS_SHORT: WEEKDAYS_SHORT
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Jalali = api;
})(typeof self !== 'undefined' ? self : this);
