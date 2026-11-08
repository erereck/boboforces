// Página FALSA do jogo para os prints, para testar o `scripts/prints.ts` de ponta a ponta no Edge sem o build
// (`npm run prints -- --falso`). Imita o contrato `GameDebugApi` no `window.__bfDebug.print` e desenha numa canvas 2D
// o estado pedido (câmera, hora, dose, cinza, mip, HUD, folha das fontes, rota do atlas), para cada PNG sair
// diferente e dar para conferir a folha de contato. Sem `?bench` na URL ela imita o título (`screen: 'title'`, sem
// gancho), com os 9 itens de teste quando a URL pede a prévia do Switch (`?titulo=switch`). Nada aqui vai para o jogo.

/** Câmeras e rotas com nome fixo do mapa (contrato `PRINT_CAMERAS` + `BENCH_ROUTES` do format). */
export const FAKE_CAMERAS: readonly string[] = [
  'print:dia',
  'print:densidade-1m',
  'print:densidade-3m',
  'print:doses',
  'print:leitura-5m',
  'print:leitura-15m',
  'print:leitura-30m',
  'print:leitura-50m',
  'print:mip',
  'print:altura',
  'print:setores-norte',
  'print:setores-sul',
  'print:setores-4-5',
  'bench:volta',
  'bench:alto',
];

/** HTML completo da página falsa (script inline, sem dependências). */
export function fakePrintsPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>BoboForces (página falsa dos prints)</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#bf-game{display:block;width:100%;height:100%}</style>
</head>
<body>
<canvas id="bf-game"></canvas>
<script>
(function () {
  var cameras = ${JSON.stringify(FAKE_CAMERAS)};
  var query = location.search;
  var scene = /[?&]bench(?:[=&]|$)/i.test(query);
  var atlas = /[?&]atlas=1(?:&|$)/.test(query);
  var switchTitle = /[?&]titulo=switch(?:&|$)/i.test(query);
  var canvas = document.getElementById('bf-game');
  var ctx = canvas.getContext('2d');
  var state = { camera: null, tod: 'day', dose: 'double', gray: false, mip: 'nearest',
    hud: true, viewmodel: true, frozen: false, specimen: false };
  var ready = false;
  var frames = 0;
  var sky = { day: '#8fb8de', dusk: '#d98b4a', night: '#1b2340' };
  function resize() {
    canvas.width = Math.max(1, Math.round(innerWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(innerHeight * devicePixelRatio));
  }
  function text(lines, w, h) {
    ctx.fillStyle = '#e8ede6';
    ctx.font = Math.round(h / 24) + 'px monospace';
    lines.forEach(function (t, k) { ctx.fillText(t, 12, (k + 1) * Math.round(h / 20)); });
  }
  function drawTitle(w, h) {
    ctx.fillStyle = '#0a0d0b';
    ctx.fillRect(0, 0, w, h);
    text(['TÍTULO (falso) ' + (switchTitle ? 'switch' : 'web'), 'tela=' + w + 'x' + h + ' frame=' + frames], w, h);
    var items = switchTitle ? 9 : 1;
    for (var i = 0; i < items; i++) {
      ctx.fillStyle = '#2a352e';
      ctx.fillRect(w * 0.55 + (i % 2) * w * 0.2, h * 0.3 + Math.floor(i / 2) * h * 0.1, w * 0.18, h * 0.07);
    }
  }
  function drawScene(w, h) {
    ctx.filter = state.gray ? 'grayscale(1)' : 'none';
    ctx.fillStyle = sky[state.tod] || '#f0f';
    ctx.fillRect(0, 0, w, h);
    var cell = state.mip === 'nearest' ? 8 : 4;
    for (var y = Math.floor(h * 0.6); y < h; y += cell) {
      for (var x = 0; x < w; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) & 1) ? '#7d8580' : '#5b625e';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    var props = state.dose === 'blocks' ? 0 : state.dose === 'proposal' ? 3 : 6;
    for (var i = 0; i < props; i++) {
      ctx.fillStyle = '#b5652b';
      ctx.fillRect(w * 0.1 + i * w * 0.12, h * 0.5, w * 0.06, h * 0.1);
    }
    var m = /leitura-(\\d+)m/.exec(state.camera || '');
    var size = m ? Math.max(4, (h * 0.5) / Number(m[1])) : h * 0.3;
    if (state.camera === 'print:altura') size = h * 0.4;
    [['#ff7a1a', 0.42], ['#3a7bd5', 0.55]].forEach(function (b) {
      ctx.fillStyle = b[0];
      ctx.fillRect(w * b[1], h * 0.6 - size, size * 0.5, size);
    });
    if (state.hud) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h - Math.min(h, 60), w, Math.min(h, 60));
      ctx.fillStyle = '#f2b233';
      ctx.fillRect(16, h - 44, w * 0.2, 24);
    }
    ctx.fillStyle = state.specimen ? '#0a0d0b' : 'rgba(0,0,0,0.55)';
    if (state.specimen) ctx.fillRect(0, 0, w, h); else ctx.fillRect(0, 0, w, Math.min(h, 120));
    text(state.specimen
      ? ['FOLHA DAS FONTES EM USO (falsa)', 'BoboForces Display · BoboForces HUD', '0123456789 ÁÉÍÓÚ ÇÃÕ']
      : ['câmera=' + state.camera + ' hora=' + state.tod + ' dose=' + state.dose + (atlas ? ' ATLAS' : ''),
         'cinza=' + state.gray + ' mip=' + state.mip + ' hud=' + state.hud,
         'tela=' + w + 'x' + h + ' frame=' + frames + ' congelado=' + state.frozen], w, h);
    ctx.filter = 'none';
  }
  function draw() {
    if (scene) drawScene(canvas.width, canvas.height); else drawTitle(canvas.width, canvas.height);
  }
  function loop() { frames++; draw(); requestAnimationFrame(loop); }
  function whenReady(n) {
    var target = frames + (n === undefined ? 3 : n);
    return new Promise(function (done) {
      (function wait() { if (frames >= target) done(); else requestAnimationFrame(wait); })();
    });
  }
  var print = {
    get readyForPrint() { return ready; },
    cameras: cameras,
    setCamera: function (name) { if (name !== null && cameras.indexOf(name) < 0) return false; state.camera = name; return true; },
    setTimeOfDay: function (v) { state.tod = v; },
    setPropDose: function (v) { state.dose = v; },
    setGrayscale: function (v) { state.gray = !!v; },
    setMipFilter: function (v) { state.mip = v; },
    setHudVisible: function (v) { state.hud = !!v; },
    setViewmodelVisible: function (v) { state.viewmodel = !!v; },
    setFrozen: function (v) { state.frozen = !!v; },
    showFontSpecimen: function (v) { state.specimen = !!v; },
    whenReady: whenReady
  };
  window.__bfDebug = {
    screen: scene ? 'scene' : 'title', paused: false, simTick: 0,
    get frames() { return frames; },
    stats: { programs: 0, drawCalls: 0, triangles: 0, viewports: 1, views: [] },
    print: scene ? print : null, bench: null, benchWarnings: [], benchReport: null,
    log: function () { return []; }
  };
  addEventListener('resize', resize);
  resize();
  loop();
  setTimeout(function () { ready = true; }, 300);
})();
</script>
</body>
</html>
`;
}
