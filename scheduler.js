/* Fair on-call scheduler. Pure functions, no DOM. */
(function (root) {
  'use strict';

  var LABELS = ['الف', 'ب', 'پ', 'ت', 'ث', 'ج', 'چ', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'ژ', 'س', 'ش',
    'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ه', 'ی'];
  var MAX_GROUPS = LABELS.length;
  var HARD = 1e6;      // penalty for a back-to-back pair (never accepted by the search)
  var BIG = 50;        // weight of points fairness versus spacing

  /* Group sizes: G = ceil(total / max), as equal as possible, bigger first. */
  function groupSizes(total, max) {
    var G = Math.ceil(total / max);
    var base = Math.floor(total / G), rem = total % G, out = [], i;
    for (i = 0; i < G; i++) out.push(i < rem ? base + 1 : base);
    return out;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Largest-remainder rounding of N * share, ties broken by the seeded random.
     No group may get more than `cap` shifts (needed for the rest rule). */
  function quotas(N, shares, rnd, cap) {
    var G = shares.length, q = [], idx = [], key = [], sum = 0, g, k;
    for (g = 0; g < G; g++) {
      q.push(Math.floor(shares[g] * N + 1e-9));
      sum += q[g]; idx.push(g); key.push(rnd());
    }
    function need(a) { return shares[a] * N - q[a]; }
    idx.sort(function (a, b) {
      var d = need(b) - need(a);
      return Math.abs(d) > 1e-9 ? d : key[a] - key[b];
    });
    for (k = 0; k < N - sum; k++) q[idx[k % G]]++;
    if (cap != null && G > 1) {
      var excess = 0;
      for (g = 0; g < G; g++) if (q[g] > cap) { excess += q[g] - cap; q[g] = cap; }
      while (excess > 0) {
        var best = -1;
        for (g = 0; g < G; g++) {
          if (q[g] < cap && (best < 0 || need(g) > need(best) + 1e-9)) best = g;
        }
        if (best < 0) break;
        q[best]++; excess--;
      }
    }
    return q;
  }

  function gapCost(d, ideal) {
    if (d === 1) return HARD;
    var r = (d - ideal) / ideal;
    return r < 0 ? 3 * r * r : r * r;
  }
  function edgeCost(e, ideal) {
    if (e <= ideal) return 0;
    var r = (e - ideal) / ideal;
    return r * r;
  }

  /* Full cost of an assignment (used to compare restarts). */
  function fullCost(asg, w, G, target, ideal, wm) {
    var N = asg.length, P = new Float64Array(G), last = new Int32Array(G).fill(-1), c = 0, i, g;
    for (i = 0; i < N; i++) {
      g = asg[i]; P[g] += w[i];
      c += last[g] < 0 ? edgeCost(i + 1, ideal[g]) : gapCost(i - last[g], ideal[g]);
      last[g] = i;
    }
    for (g = 0; g < G; g++) {
      if (last[g] >= 0) c += edgeCost(N - last[g], ideal[g]);
      var d = (P[g] - target[g]) / wm;
      c += BIG * d * d;
    }
    return c;
  }

  function countViolations(asg) {
    var v = 0;
    for (var i = 1; i < asg.length; i++) if (asg[i] === asg[i - 1]) v++;
    return v;
  }

  /* One simulated-annealing run. Returns {asg, cost}. */
  function runSearch(w, G, quota, target, ideal, wm, rnd, iters) {
    var N = w.length, asg = new Int32Array(N), P = new Float64Array(G);
    var g, k, i, j;

    // evenly spaced start (a generalised round-robin that respects quotas)
    var perm = [];
    for (g = 0; g < G; g++) perm.push(g);
    for (g = G - 1; g > 0; g--) { k = (rnd() * (g + 1)) | 0; i = perm[g]; perm[g] = perm[k]; perm[k] = i; }
    var items = [];
    for (g = 0; g < G; g++) {
      for (k = 0; k < quota[g]; k++) {
        items.push({ p: (k + (perm[g] + 0.5) / G) * N / quota[g], g: g, o: perm[g] });
      }
    }
    items.sort(function (a, b) { return a.p - b.p || a.o - b.o; });
    for (i = 0; i < N; i++) { asg[i] = items[i].g; P[asg[i]] += w[i]; }

    function prev(gr, pos) { var x = pos - 1; while (x >= 0 && asg[x] !== gr) x--; return x; }
    function next(gr, pos) { var x = pos + 1; while (x < N && asg[x] !== gr) x++; return x; }
    function pair(gr, p, n) {
      if (p < 0) return n >= N ? 0 : edgeCost(n + 1, ideal[gr]);
      if (n >= N) return edgeCost(N - p, ideal[gr]);
      return gapCost(n - p, ideal[gr]);
    }
    // gr is at x and not at y: cost of every gap that a swap of x<->y can change
    function local(gr, x, y) {
      var p = prev(gr, x), n = next(gr, x);
      var c = pair(gr, p, x) + pair(gr, x, n);
      var py = prev(gr, y), ny = next(gr, y);
      if (py !== x && ny !== x) c += pair(gr, py, ny);
      return c;
    }
    function trySwap(a_i, b_j, T) {
      var a = asg[a_i], b = asg[b_j];
      if (a === b) return false;
      var before = local(a, a_i, b_j) + local(b, b_j, a_i);
      var dw = (w[b_j] - w[a_i]) / wm;
      var da = (P[a] - target[a]) / wm, db = (P[b] - target[b]) / wm;
      var dPts = BIG * ((da + dw) * (da + dw) - da * da + (db - dw) * (db - dw) - db * db);
      asg[a_i] = b; asg[b_j] = a;
      var delta = local(a, b_j, a_i) + local(b, a_i, b_j) - before + dPts;
      if (delta <= 0 || (T > 0 && rnd() < Math.exp(-delta / T))) {
        P[a] += w[b_j] - w[a_i]; P[b] += w[a_i] - w[b_j];
        return true;
      }
      asg[a_i] = a; asg[b_j] = b;
      return false;
    }

    var R = Math.max(2, Math.ceil(1.5 * G)), T0 = 1, T1 = 0.004, T;
    var ratio = Math.pow(T1 / T0, 1 / iters);
    for (k = 0, T = T0; k < iters; k++, T *= ratio) {
      i = (rnd() * N) | 0;
      if (rnd() < 0.5) {
        j = i + ((rnd() * (2 * R + 1)) | 0) - R;
        if (j < 0 || j >= N) continue;
      } else j = (rnd() * N) | 0;
      trySwap(i, j, T);
    }

    // safety net: remove any remaining back-to-back pair with the best possible swap
    var guard = 0;
    while (countViolations(asg) > 0 && guard++ < 200) {
      var fixed = false;
      for (i = 1; i < N && !fixed; i++) {
        if (asg[i] !== asg[i - 1]) continue;
        for (j = 0; j < N && !fixed; j++) fixed = trySwap(i, j, 0);
      }
      if (!fixed) break;
    }
    return { asg: asg, cost: fullCost(asg, w, G, target, ideal, wm) };
  }

  /*
    input: {
      weights: number[]   hardness of every slot, in time order
      bases:   number[]   starting value of every slot (optional; for harder/easier counts)
      sizes:   number[]   interns per group
      proportional: bool  true = share proportional to group size, false = equal share
      seed:    integer
    }
    Back-to-back = two neighbouring slots in time order (this covers day+night on one
    date, night then next day, and two nights in a row in night-only mode).
  */
  function schedule(input) {
    var w = input.weights, N = w.length, sizes = input.sizes, G = sizes.length;
    var bases = input.bases || w.map(function () { return 1; });
    var rnd = mulberry32((input.seed | 0) * 2654435761 + 12345);
    var g, i, totalPeople = 0, W = 0;
    if (G < 1 || G > MAX_GROUPS) throw new Error('bad group count');
    for (g = 0; g < G; g++) totalPeople += sizes[g];
    for (i = 0; i < N; i++) W += w[i];
    var wm = N ? W / N : 1;
    if (!(wm > 0)) wm = 1;

    var shares = sizes.map(function (s) { return input.proportional ? s / totalPeople : 1 / G; });
    var asg, quota;

    if (G === 1) {
      asg = new Int32Array(N); quota = [N];
    } else if (G === 2) {
      // only two layouts keep the rest rule: A,B,A,B… or B,A,B,A…  pick the fairer one
      var best = null;
      for (var s = 0; s < 2; s++) {
        var a2 = new Int32Array(N), p0 = 0, c0 = 0;
        for (i = 0; i < N; i++) { a2[i] = (i + s) % 2; if (!a2[i]) { p0 += w[i]; c0++; } }
        var dev = Math.abs(p0 - W * shares[0]) + Math.abs(c0 - N * shares[0]) * 1e-3 + rnd() * 1e-6;
        if (!best || dev < best.dev - 1e-9) best = { dev: dev, asg: a2, q: [c0, N - c0] };
      }
      asg = best.asg; quota = best.q;
    } else {
      quota = quotas(N, shares, rnd, Math.ceil(N / 2));
      var target0 = shares.map(function (sh) { return sh * W; });
      var ideal = quota.map(function (q) { return q > 0 ? N / q : N; });
      var iters = Math.max(15000, Math.min(45000, N * 100)), bestRun = null;
      for (var r = 0; r < 3; r++) {
        var run = runSearch(w, G, quota, target0, ideal, wm, rnd, iters);
        if (!bestRun || run.cost < bestRun.cost) bestRun = run;
      }
      asg = bestRun.asg;
    }

    // fairness report
    var groups = [];
    for (g = 0; g < G; g++) {
      groups.push({
        index: g, label: LABELS[g], size: sizes[g], quota: quota[g], share: shares[g],
        target: W * shares[g], count: 0, points: 0, harder: 0, normal: 0, easier: 0,
        minGap: null, slots: []
      });
    }
    for (i = 0; i < N; i++) {
      var gr = groups[asg[i]];
      if (gr.slots.length) {
        var gap = i - gr.slots[gr.slots.length - 1];
        if (gr.minGap === null || gap < gr.minGap) gr.minGap = gap;
      }
      gr.slots.push(i); gr.count++; gr.points += w[i];
      if (w[i] > bases[i] + 1e-9) gr.harder++;
      else if (w[i] < bases[i] - 1e-9) gr.easier++;
      else gr.normal++;
    }
    var maxDev = 0;
    groups.forEach(function (x) {
      x.points = Math.round(x.points * 1000) / 1000;
      x.deviation = x.points - x.target;
      if (Math.abs(x.deviation) > maxDev) maxDev = Math.abs(x.deviation);
    });
    return {
      assignment: Array.prototype.slice.call(asg),
      groups: groups,
      totalPoints: W,
      maxDeviation: maxDev,
      violations: G >= 2 ? countViolations(asg) : 0
    };
  }

  var api = {
    LABELS: LABELS, MAX_GROUPS: MAX_GROUPS, groupSizes: groupSizes,
    quotas: quotas, mulberry32: mulberry32, schedule: schedule
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof self !== 'undefined' ? self : this);
