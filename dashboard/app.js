// Token Radar's page: it renders the one object the program wrote (window.RADAR, from ../data.js) and
// computes nothing of its own, so what a reader sees is the board the gate read and the screenshots and
// the source cannot disagree. Routes are the hash: '' the board, '#/p/<slug>' one protocol, '#/live' the
// traded comps, '#/method' the model.

(function () {
  'use strict';
  var R = window.RADAR;
  var view = document.getElementById('view');
  var S = { q: '', tier: '', verdict: '', category: '', chain: '', minTvl: 0, sort: 'rank', dir: 1, limit: 60 };
  var nf = new Intl.NumberFormat('en-US');

  function money(v) {
    if (!isFinite(v)) return '—';
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  var exact = function (v) { return isFinite(v) ? '$' + nf.format(Math.round(v)) : '—'; };
  var pct = function (v) { return v === null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };
  var mult = function (v) { return !isFinite(v) ? '—' : (v >= 10 ? v.toFixed(1) : v.toFixed(2)) + '×'; };
  function months(d) {
    if (d === null) return 'no listing day';
    if (d < 45) return d + ' days';
    return d < 700 ? (d / 30.44).toFixed(1) + ' months' : (d / 365.25).toFixed(1) + ' years';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  var tag = function (t) { return t === 'extended' ? 'above floor' : t; };
  var rate = function (r) { return r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'; };

  // ---- filters -------------------------------------------------------------------

  function filtered() {
    var rows = R.rows.filter(function (r) {
      if (S.tier && r.tier !== S.tier) return false;
      if (S.verdict && r.verdict !== S.verdict) return false;
      if (S.category && (r.category || 'Uncategorised') !== S.category) return false;
      if (S.chain && r.chains.indexOf(S.chain) === -1) return false;
      if (S.minTvl && r.tvl_usd < S.minTvl) return false;
      return !S.q || r.name.toLowerCase().indexOf(S.q.toLowerCase()) !== -1 || r.slug.indexOf(S.q.toLowerCase()) !== -1;
    });
    rows.sort(function (a, b) {
      var x = S.sort === 'verdict' ? { farm: 0, thin: 1, skip: 2 }[a.verdict] : S.sort === 'name' ? a.name.toLowerCase() : a[S.sort];
      var y = S.sort === 'verdict' ? { farm: 0, thin: 1, skip: 2 }[b.verdict] : S.sort === 'name' ? b.name.toLowerCase() : b[S.sort];
      var d = x < y ? -1 : x > y ? 1 : 0;
      return (d === 0 ? a.rank - b.rank : d) * S.dir;
    });
    return rows;
  }
  function distinct(field) {
    var c = {};
    R.rows.forEach(function (r) {
      (Array.isArray(r[field]) ? r[field] : [r[field] || 'Uncategorised']).forEach(function (k) { c[k] = (c[k] || 0) + 1; });
    });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); });
  }
  function chipRow(id, pairs, current) {
    return '<div class="chips" id="' + id + '">' + pairs.map(function (p) {
      return '<button type="button" data-v="' + p[0] + '" aria-pressed="' + (current === p[0]) + '">' + p[1] + '</button>';
    }).join('') + '</div>';
  }
  function pickRow(id, list, current) {
    return '<select id="' + id + '"><option value="">all</option>' + list.map(function (c) {
      return '<option value="' + esc(c) + '"' + (current === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('') + '</select>';
  }

  // ---- shell ---------------------------------------------------------------------

  function shell() {
    document.getElementById('tag').textContent = R.board_size + ' protocols that record no token, ranked by what a token launch would be worth — sealed DefiLlama snapshot of ' + R.as_of;
    document.getElementById('facts').innerHTML = [
      ['Watchlist', R.watchlist_covered + '/' + R.watchlist_size, R.watchlist_covered === R.watchlist_size],
      ['Rows ranked', R.board_size, false], ['Comps fitted', R.model.n, false], ['Snapshot', R.as_of, false]
    ].map(function (f) { return '<div><dt>' + f[0] + '</dt><dd' + (f[2] ? ' class="ok"' : '') + '>' + f[1] + '</dd></div>'; }).join('');

    // The model strip is the board's own claim about its own accuracy, measured on the snapshot.
    var b = R.model.beta, v = R.validation.rows;
    document.getElementById('strip').innerHTML = [
      ['The fitted model, ' + R.model_version,
        '<span class="eq">ln(mcap) = <b>' + b[0].toFixed(3) + '</b> + <b>' + b[1].toFixed(3) + '</b>·ln(TVL) + <b>' + b[2].toFixed(4) + '</b>·growth</span>' +
        '<p>Fit on ' + R.model.n + ' traded protocols, R² ' + R.model.r2.toFixed(3) + ', σ ' + R.model.sigma.toFixed(3) + '. Elasticity ' + b[1].toFixed(2) + ': a larger protocol trades at a <em>smaller</em> multiple of TVL.</p>'],
      ['Median error, left one out', '<span class="eq"><b>' + v[0].median_abs_log_error.toFixed(3) + '</b> ln units <span class="win">(×' + v[0].typical_ratio.toFixed(2) + ')</span></span><p>Measured, not asserted: each comp refitted without itself.</p>'],
      ['Flat multiple baseline', '<span class="eq">' + v[1].median_abs_log_error.toFixed(3) + ' (×' + v[1].typical_ratio.toFixed(2) + ')</span><p>TVL × the median mcap/TVL multiple of ' + R.model.flat_multiple.toFixed(3) + ', scored the same way.</p>'],
      ['Category-peers baseline', '<span class="eq">' + v[2].median_abs_log_error.toFixed(3) + ' (×' + v[2].typical_ratio.toFixed(2) + ')</span><p>The same multiple taken inside the protocol’s own category.</p>']
    ].map(function (c) { return '<div><h2>' + c[0] + '</h2><div>' + c[1] + '</div></div>'; }).join('');

    document.getElementById('foot').innerHTML =
      '<p>Source: ' + esc(R.source) + '. Every figure here was computed from that snapshot by the program that wrote this board: the model is <code>dashboard/model.mjs</code>, the planner <code>dashboard/farm.mjs</code>, the rows <code>dashboard/board.mjs</code> — the program imports them out of this same directory. The page is static, has no framework and no network, and computes nothing of its own, so the board and this source cannot disagree.</p>' +
      '<p>An implied value is this radar’s own claim about what a token would be worth if the protocol’s record stayed as it is. It is not a prediction that a token will be issued, and it is not investment advice. DefiLlama’s record is not proof: a protocol here may hold a token its record does not carry. Farming costs real money and can lose it.</p>';
  }

  // ---- the board -----------------------------------------------------------------

  function rail() {
    var r = el('aside', 'rail');
    r.innerHTML =
      '<div class="field"><label for="fq">Search</label><input id="fq" type="search" placeholder="name or slug" value="' + esc(S.q) + '"></div>' +
      '<div class="field"><label for="ftvl">Minimum TVL (USD)</label><input id="ftvl" type="number" min="0" step="1000000" placeholder="any" value="' + (S.minTvl || '') + '"></div>' +
      '<div class="field"><label>Tier</label>' + chipRow('ctier', [['', 'all'], ['watchlist', 'watchlist ' + R.tier_counts.watchlist], ['extended', 'above floor ' + R.tier_counts.extended], ['early', 'early ' + R.tier_counts.early]], S.tier) + '</div>' +
      '<div class="field"><label>Farm verdict</label>' + chipRow('cver', [['', 'all'], ['farm', 'farm ' + R.verdict_counts.farm], ['thin', 'thin ' + R.verdict_counts.thin], ['skip', 'skip ' + R.verdict_counts.skip]], S.verdict) + '</div>' +
      '<div class="field"><label for="fcat">Category</label>' + pickRow('fcat', distinct('category'), S.category) + '</div>' +
      '<div class="field"><label for="fchain">Chain</label>' + pickRow('fchain', distinct('chains').slice(0, 60), S.chain) + '</div>' +
      '<p class="count"></p><button class="reset" type="button">Reset every filter</button>';
    r.querySelector('#fq').oninput = function () { S.q = this.value; render(); };
    r.querySelector('#ftvl').oninput = function () { S.minTvl = Number(this.value) || 0; render(); };
    r.querySelector('#fcat').onchange = function () { S.category = this.value; render(); };
    r.querySelector('#fchain').onchange = function () { S.chain = this.value; render(); };
    r.querySelector('.reset').onclick = function () { S = { q: '', tier: '', verdict: '', category: '', chain: '', minTvl: 0, sort: 'rank', dir: 1, limit: 60 }; render(); };
    r.querySelector('#ctier').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.tier = b.dataset.v; render(); } };
    r.querySelector('#cver').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.verdict = b.dataset.v; render(); } };
    return r;
  }

  var COLS = [
    ['rank', '#', 'num r'], ['name', 'Protocol', ''], ['category', 'Category / chains', ''],
    ['tvl_usd', 'TVL', 'num r'], ['change_7d', '7d', 'num r'], ['age_days', 'No token for', 'num r'],
    ['multiple', 'Multiple', 'num r'], ['implied_value_usd', 'Implied value', 'num r'],
    ['flat_usd', 'Flat says', 'num r'], ['verdict', 'Farm', '']
  ];

  function board() {
    var wrap = el('div', 'board'), r = rail(), rows = filtered(), right = el('div');
    var maxTvl = Math.max.apply(null, R.rows.map(function (x) { return x.tvl_usd; }));
    wrap.appendChild(r);
    var head = COLS.map(function (c) {
      return '<th class="' + c[2] + '" data-sort="' + c[0] + '" title="Sort by ' + c[1] + '">' + c[1] +
        (S.sort === c[0] ? '<span class="arw">' + (S.dir === 1 ? ' ▲' : ' ▼') + '</span>' : '') + '</th>';
    }).join('');
    var body = rows.slice(0, S.limit).map(function (x) {
      return '<tr><td class="num r rank">' + x.rank + '</td>' +
        '<td><div class="who"><div class="tierbar"><a class="nm" href="#/p/' + encodeURIComponent(x.slug) + '">' + esc(x.name) + '</a>' +
        '<span class="chip ' + x.tier + '">' + tag(x.tier) + '</span></div><div class="sub">' + esc(x.slug) + '</div></div></td>' +
        '<td class="nowrap"><span>' + esc(x.category || '—') + '</span><span class="sub">' + esc(x.chains.slice(0, 2).join(', ') + (x.chains.length > 2 ? ' +' + (x.chains.length - 2) : '')) + '</span></td>' +
        '<td class="num r">' + money(x.tvl_usd) + '<span style="display:block;width:56px;margin:3px 0 0 auto;background:#1b2431;height:3px;border-radius:2px">' +
          '<span style="display:block;height:3px;border-radius:2px;background:#f0b429;width:' + Math.max(4, Math.round((x.tvl_usd / maxTvl) * 100)) + '%"></span></span></td>' +
        '<td class="num r nowrap ' + rate(x) + '">' + pct(x.change_7d) + '</td>' +
        '<td class="num r nowrap mut">' + months(x.age_days) + '</td>' +
        '<td class="num r nowrap">' + mult(x.multiple) + '</td>' +
        '<td class="num r val nowrap">' + money(x.implied_value_usd) + '</td>' +
        '<td class="num r mut nowrap">' + money(x.flat_usd) + '</td>' +
        '<td><span class="chip ' + x.verdict + '">' + x.verdict + '</span></td></tr>';
    }).join('');
    right.innerHTML = '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    right.querySelector('thead').onclick = function (e) {
      var th = e.target.closest('th[data-sort]');
      if (!th) return;
      var k = th.dataset.sort;
      if (S.sort === k) S.dir = -S.dir;
      else { S.sort = k; S.dir = k === 'name' || k === 'verdict' || k === 'category' ? 1 : -1; }
      render();
    };
    if (rows.length > S.limit) {
      var more = el('button', 'reset', 'Show ' + Math.min(200, rows.length - S.limit) + ' more of ' + rows.length + ' matching rows');
      more.style.marginTop = '12px';
      more.onclick = function () { S.limit += 200; render(); };
      right.appendChild(more);
    }
    wrap.appendChild(right);
    view.innerHTML = '';
    view.appendChild(wrap);
    r.querySelector('.count').innerHTML = '<b>' + rows.length + '</b> of ' + R.board_size + ' rows match, ' +
      rows.filter(function (x) { return x.tier === 'watchlist'; }).length + ' of them on the house watchlist.';
  }

  // ---- one protocol --------------------------------------------------------------

  function detail(slug) {
    var row = null;
    R.rows.forEach(function (x) { if (x.slug === slug) row = x; });
    view.innerHTML = '';
    if (!row) {
      view.appendChild(el('p', 'empty', 'No protocol on the board has the slug ' + esc(slug) + '. <a href="#/">Back to the board</a>.'));
      return;
    }
    var b = R.model.beta, i = row.model_inputs;
    var fitted = Math.exp(i.ln_tvl * b[1] + b[0] + b[2] * i.growth_pct);
    var lo = Math.log(Math.max(1, row.band_low_usd)), hi = Math.log(Math.max(2, row.band_high_usd));
    var bandPos = Math.min(99, Math.max(0, ((Math.log(row.implied_value_usd) - lo) / (hi - lo || 1)) * 100));
    // The derivation is monospace, so every row is padded to one column axis a reader can add down.
    var row_ = function (label, value) { return label + ' '.repeat(Math.max(1, 23 - label.length)) + value.padStart(17) + '\n'; };
    var facts = [
      ['TVL', exact(row.tvl_usd)], ['Seven-day change', pct(row.change_7d)],
      ['Listed', row.listed_at ? esc(row.listed_at) + ' — ' + months(row.age_days) + ' with no token' : 'no listing day in the snapshot'],
      ['Rank tier', row.tier === 'watchlist' ? 'on the house watchlist' : row.tier === 'extended' ? 'above the floor, outside the house list' : 'below the $' + R.floor_usd / 1e6 + 'M floor'],
      ['Capital the plan needs', exact(row.capital_usd)],
      ['Cost as a share of it', ((row.cost_usd / row.capital_usd) * 100).toFixed(1) + '%'],
      ['Farm verdict', row.verdict]
    ].map(function (p) { return '<dt>' + p[0] + '</dt><dd' + (p[0] === 'Farm verdict' ? ' class="hi"' : '') + '>' + p[1] + '</dd>'; }).join('');

    view.innerHTML = '<div class="detail">' +
      '<div class="head">' +
        '<div><h2>' + esc(row.name) + '</h2><p class="sub"><a class="back" href="#/">&larr; Board</a> <span class="chip ' + row.tier + '">' + tag(row.tier) + '</span> ' +
        esc(row.category || 'no category') + ' · ' + esc(row.chains.join(', ')) + ' · no token for ' + months(row.age_days) + '</p></div>' +
        '<div class="hero"><div class="big num">' + money(row.implied_value_usd) + '</div><div class="cap">implied launch value · rank ' + row.rank + ' of ' + R.board_size + '</div></div></div>' +
      '<div class="stack">' +
        '<section class="card"><h2>The record</h2><dl class="kv">' + facts + '</dl></section>' +
        '<section class="card"><h2>How this number was reached</h2><div class="derive">' +
        row_('ln(TVL)', i.ln_tvl.toFixed(4)) +
        row_('growth, banded', i.growth_pct.toFixed(2) + '%') + '\n' +
        row_('fitted median', exact(fitted)) +
        row_('x maturity(' + (row.age_days === null ? R.model.unknown_age_days + 'd' : row.age_days + 'd') + ')', i.maturity.toFixed(4)) +
        row_('= implied value', exact(row.implied_value_usd)) + '\n' +
        row_('90% band low', money(row.band_low_usd)) +
        row_('90% band high', money(row.band_high_usd)) +
        row_('mean, not median', money(row.mean_usd)) +
        row_('flat multiple says', money(row.flat_usd)) + '\n' +
        row_('implied / TVL', mult(row.multiple)) + '</div>' +
        '<div class="bar"><span style="left:0;width:100%"></span><span style="left:' + bandPos.toFixed(2) + '%;width:2px;background:#f0b429"></span></div>' +
        '<p class="mut" style="font-size:11.5px;margin:5px 0 0">The band is wide because the comps are: a market cap is a noisy multiple of TVL, and this publishes that rather than hiding it.</p></section>' +
      '</div>' +
      '<section class="card"><h2>How to farm it — ' + esc(row.chains.length ? row.chains[0] : 'its main chain') + ', ' + row.hold_days + '-day hold</h2>' +
        '<ol class="steps">' + row.farm_steps.map(function (s) { return '<li><div><p>' + esc(s) + '</p></div></li>'; }).join('') + '</ol></section></div>';
  }

  // ---- the comps and the method --------------------------------------------------

  function live() {
    view.innerHTML = '<section class="card"><h2>The ' + R.live.length + ' traded protocols the model was fitted on</h2>' +
      '<p class="mut" style="font-size:13px;margin:0 0 14px">These already record a token, so the board does not rank them: they are the evidence. Their realised multiple is their market cap over their TVL, and the fitted model reproduces these from TVL and growth alone.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class="num r">TVL</th><th class="num r">Market cap</th>' +
      '<th class="num r">Multiple</th><th class="num r">7d</th><th class="num r">Age</th></tr></thead><tbody>' +
      R.live.map(function (x, i) {
        return '<tr><td class="num r rank">' + (i + 1) + '</td><td><b>' + esc(x.name) + '</b></td><td class="mut">' + esc(x.category || '—') + '</td>' +
          '<td class="num r">' + money(x.tvl_usd) + '</td><td class="num r">' + money(x.mcap_usd) + '</td><td class="num r">' + mult(x.realised_multiple) + '</td>' +
          '<td class="num r ' + rate(x) + '">' + pct(x.change_7d) + '</td><td class="num r mut">' + months(x.age_days) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  function method() {
    var m = R.model, v = R.validation.rows, b = m.beta;
    view.innerHTML = '<section class="card method"><h2>The value model, ' + R.model_version + '</h2>' +
      '<p>Fitted on the ' + m.n + ' protocols that already trade: <code>ln(mcap) = ' + b[0].toFixed(3) + ' + ' + b[1].toFixed(3) + '·ln(TVL) + ' + b[2].toFixed(4) + '·growth</code>, by least squares at run time from the snapshot alone. No constant written down, no protocol name read. The fit uses the middle ' + ((1 - 2 * m.trim_share) * 100).toFixed(0) + ' per cent of realised multiples, trimming ' + m.trimmed + ' of ' + (m.n + m.trimmed) + '.</p>' +
      '<p>TVL elasticity <b>' + b[1].toFixed(3) + '</b> is below 1, which is what the comps say: a larger protocol trades at a <em>smaller</em> multiple of its TVL, so the flat multiple of ' + m.flat_multiple.toFixed(3) + ' over-values the largest protocols. Two terms are <b>stated priors</b>, not fitted: growth banded to ' + m.growth_band[0] + '% to +' + m.growth_band[1] + '%, and maturity <code>0.55 + 0.45·min(age, ' + m.maturity_days + ')/' + m.maturity_days + '</code> — a prior over protocols with no token, because every comp has already launched. No listing day means ' + m.unknown_age_days + ' days. The published number is the fitted <b>median</b>, not the mean: the lognormal tail is worth a factor of ' + m.smearing.toFixed(2) + '.</p>' +
      '<table><thead><tr><th>Model</th><th class="r">Median error, left one out</th><th class="r">Typical factor</th></tr></thead><tbody>' +
      v.map(function (x, i) { return '<tr><td>' + (i === 0 ? '<b>' + esc(x.name) + '</b> <span class="chip farm">best</span>' : esc(x.name)) + '</td><td class="num r">' + x.median_abs_log_error.toFixed(3) + '</td><td class="num r">×' + x.typical_ratio.toFixed(2) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<p class="mut" style="font-size:12.5px;margin-top:14px">Each comp refitted with itself left out, so every number is out of sample on the snapshot’s own evidence. The fitted core beats both baselines on the same ' + R.validation.n + ' comps.</p></section>' +
      '<section class="card" style="margin-top:22px"><h2>What each category actually trades at</h2>' +
      '<p class="mut" style="font-size:13px;margin:0 0 12px">The comps’ realised mcap/TVL multiple by category, most-peered first: the market’s own answer beside the model’s.</p>' +
      '<table><thead><tr><th>Category</th><th class="r">Comps</th><th class="r">Median multiple</th></tr></thead><tbody>' +
      R.categories.map(function (c) { return '<tr><td>' + esc(c.category) + '</td><td class="num r mut">' + c.peers + '</td><td class="num r">' + mult(c.median_multiple) + '</td></tr>'; }).join('') +
      '</tbody></table></section>';
  }

  // ---- routing -------------------------------------------------------------------

  function render() {
    var route = location.hash.replace(/^#\/?/, '');
    var active = route.indexOf('p/') === 0 ? '' : route || 'board';
    var nav = document.getElementById('views');
    nav.innerHTML = [['', 'Board'], ['live', 'Traded comps'], ['method', 'Method']].map(function (v) {
      return '<button type="button" data-go="' + v[0] + '"' + (active === (v[0] || 'board') ? ' aria-current="page"' : '') + '>' + v[1] + '</button>';
    }).join('');
    nav.onclick = function (e) { var b = e.target.closest('button'); if (b) location.hash = b.dataset.go ? '#/' + b.dataset.go : '#/'; };
    if (route.indexOf('p/') === 0) detail(decodeURIComponent(route.slice(2)));
    else if (route === 'live') live();
    else if (route === 'method') method();
    else board();
  }

  shell();
  window.addEventListener('hashchange', render);
  render();
})();
