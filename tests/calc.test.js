/* =====================================================================
   Pruebas automáticas de calc.js (y de que la PWA esté completa).
   Se corren con:  npm test   (o  node --test tests/*.test.js)
   No necesitan instalar nada: usan el módulo node:test de Node 18+.
   GitHub Actions las corre antes de publicar; si alguna falla, no se publica.
   ===================================================================== */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../calc.js');

const RAIZ = path.join(__dirname, '..');

/** Config de ejemplo normalizada, con cambios opcionales. */
function config(cambios) {
  const raw = Object.assign(C.clonar(C.DEFAULT_CONFIG), cambios || {});
  const { cfg, errores } = C.normalizarConfig(raw);
  assert.deepEqual(errores, [], 'la config de prueba tiene errores');
  return cfg;
}

function cortina(datos) {
  return Object.assign(C.nuevaCortina(config()), datos);
}

test('num(): entiende el formato argentino y rechaza basura', () => {
  assert.equal(C.num('150'), 150);
  assert.equal(C.num('150,5'), 150.5);
  assert.equal(C.num('150.5'), 150.5);
  assert.equal(C.num('12.000'), 12000);
  assert.equal(C.num('1.234,50'), 1234.5);
  assert.equal(C.num('$ 12.000'), 12000);
  assert.equal(C.num('0,7'), 0.7);
  assert.ok(Number.isNaN(C.num('')));
  assert.ok(Number.isNaN(C.num('abc')));
  assert.ok(Number.isNaN(C.num('1.2.3')));
  assert.ok(Number.isNaN(C.num(null)));
});

test('formatos: pesos, números y cm', () => {
  assert.equal(C.fmtPesos(1234567), '$ 1.234.567');
  assert.equal(C.fmtPesos(1234567.6), '$ 1.234.568');
  assert.equal(C.fmtPesos(0), '$ 0');
  assert.equal(C.fmtNum(1234.56, 1), '1.234,6');
  assert.equal(C.fmtNum(150, 1), '150');
  assert.equal(C.fmtCm(126), '126 cm');
});

test('cortina base: 150 × 180 Blackout (caso calculado a mano)', () => {
  const r = C.calcularCortina(cortina({ ancho: '150', alto: '180', telaId: 'blackout' }), config());
  assert.equal(r.ok, true);
  assert.equal(r.m2Reales, 2.7);
  assert.equal(r.mecanismo.diametro, 38);
  assert.deepEqual(r.cortes, { telaAncho: 146, telaLargo: 200, tubo: 147, contrapeso: 146, cadena: 126 });
  assert.equal(r.costos.tela, 40500);
  assert.equal(r.costos.tubo, 8820);
  assert.equal(r.costos.mecanismo, 9000);
  assert.equal(r.costos.contrapeso, 6570);
  assert.equal(r.costos.cadena, 1512);
  assert.equal(r.costos.manoObra, 10000);
  assert.equal(r.costoTotal, 81402);
  assert.equal(r.precio, 130243); // 81.402 × 1,6 = 130.243,2
});

test('mínimo facturable', () => {
  const r = C.calcularCortina(cortina({ ancho: '50', alto: '50', telaId: 'blackout' }), config());
  assert.equal(r.m2Reales, 0.25);
  assert.equal(r.m2Fact, 1);
  assert.equal(r.costos.tela, 15000);
});

test('elección de mecanismo por ancho (bordes de rango)', () => {
  const cfg = config();
  assert.equal(C.elegirMecanismo(150, cfg.mecanismos).mec.diametro, 38);
  assert.equal(C.elegirMecanismo(150.1, cfg.mecanismos).mec.diametro, 45);
  assert.equal(C.elegirMecanismo(250, cfg.mecanismos).mec.diametro, 45);
  assert.equal(C.elegirMecanismo(251, cfg.mecanismos).mec.diametro, 50);
});

test('cortes redondeados a 0,1 cm', () => {
  const r = C.calcularCortina(cortina({ ancho: '100,37', alto: '100,04', telaId: 'blackout' }), config());
  assert.equal(r.cortes.tubo, 97.4);
  assert.equal(r.cortes.cadena, 70); // 100,04 × 0,7 = 70,028
});

test('campos vacíos o inválidos no rompen y no suman', () => {
  const cfg = config();
  const vacia = C.calcularCortina(cortina({}), cfg);
  assert.equal(vacia.ok, false);
  assert.deepEqual(vacia.errores, ['Falta el ancho', 'Falta el alto']);
  const letras = C.calcularCortina(cortina({ ancho: 'abc', alto: '-5', telaId: 'blackout' }), cfg);
  assert.deepEqual(letras.errores, ['El ancho no es un número válido', 'El alto tiene que ser mayor a 0']);
  const sinTela = C.calcularCortina(cortina({ ancho: '100', alto: '100', telaId: 'no-existe' }), cfg);
  assert.deepEqual(sinTela.errores, ['Elegí una tela']);
  const res = C.calcularPedido({ cortinas: [vacia, cortina({ ancho: '150', alto: '180', telaId: 'blackout' })].map((x, i) => (i ? x : {})) }, cfg);
  assert.equal(res.completas, 1);
  assert.equal(res.incompletas, 1);
  assert.equal(res.total, 130243);
  assert.doesNotThrow(() => C.calcularPedido(null, cfg));
  assert.doesNotThrow(() => C.calcularCortina(null, cfg));
});

test('3 puntos: dentro del vano usa la más chica, fuera la más grande', () => {
  const base = { tresPuntos: true, anchos: ['150', '148,5', '149'], altos: ['181', '180', ''], telaId: 'blackout' };
  const dentro = C.medidasFinales(Object.assign({ colocacion: 'dentro' }, base));
  assert.equal(dentro.ok, true);
  assert.equal(dentro.ancho, 148.5);
  assert.equal(dentro.alto, 180);
  const fuera = C.medidasFinales(Object.assign({ colocacion: 'fuera' }, base));
  assert.equal(fuera.ancho, 150);
  assert.equal(fuera.alto, 181);
  const mal = C.medidasFinales({ tresPuntos: true, anchos: ['150', 'x', ''], altos: ['', '', ''] });
  assert.deepEqual(mal.errores, ['Alguna medida del ancho no es un número válido', 'Falta el alto']);
  // El cálculo usa la medida final.
  const r = C.calcularCortina(cortina(Object.assign({ colocacion: 'dentro' }, base)), config());
  assert.equal(r.ancho, 148.5);
  assert.equal(r.cortes.tubo, 145.5);
});

test('ancho de rollo: aviso, y corte girado si la tela lo permite', () => {
  const cfg = config();
  // Screen 5% no se puede girar: avisa y sugiere.
  const screen = C.calcularCortina(cortina({ ancho: '280', alto: '200', telaId: 'screen5' }), cfg);
  assert.equal(screen.rotada, false);
  assert.equal(screen.avisos.length, 2);
  assert.match(screen.avisos[0], /supera el ancho de rollo/);
  assert.match(screen.avisos[1], /girada/);
  // Blackout (rollo 300) sí: 320 de ancho no entra, pero el largo 220 sí.
  const black = C.calcularCortina(cortina({ ancho: '320', alto: '200', telaId: 'blackout' }), cfg);
  assert.equal(black.rotada, true);
  assert.deepEqual(black.avisos, []);
  assert.equal(black.notas.length, 1);
  assert.equal(black.consumoRollo, 316); // consume el ancho a lo largo del rollo
  // Si tampoco entra girada, avisa sin sugerir.
  const enorme = C.calcularCortina(cortina({ ancho: '320', alto: '300', telaId: 'blackout' }), cfg);
  assert.equal(enorme.rotada, false);
  assert.equal(enorme.avisos.length, 1);
});

test('modos de cobro de tela y desperdicio', () => {
  const c = cortina({ ancho: '150', alto: '180', telaId: 'blackout' });
  // corte: 1,46 × 2,00 = 2,92 m²
  const corte = C.calcularCortina(c, config({ telaModo: 'corte' }));
  assert.equal(corte.costos.tela, Math.round(2.92 * 15000));
  // rollo: 3,00 × 2,00 = 6 m²
  const rollo = C.calcularCortina(c, config({ telaModo: 'rollo' }));
  assert.equal(rollo.costos.tela, 90000);
  // facturable + 10 % de desperdicio: 2,7 × 1,1 = 2,97 m²
  const desp = C.calcularCortina(c, config({ desperdicioTela: 10 }));
  assert.equal(desp.costos.tela, Math.round(2.97 * 15000));
});

test('redondeo del precio hacia arriba', () => {
  const c = cortina({ ancho: '150', alto: '180', telaId: 'blackout' });
  assert.equal(C.calcularCortina(c, config({ redondeo: 500 })).precio, 130500);
  assert.equal(C.calcularCortina(c, config({ redondeo: 1000 })).precio, 131000);
  assert.equal(C.calcularCortina(c, config({ redondeo: '5000' })).precio, 135000);
  assert.equal(C.calcularCortina(c, config({ redondeo: 0 })).precio, 130243);
  assert.equal(C.redondearPrecio(130000, 500), 130000); // si ya es múltiplo, no cambia
});

test('plan de barras: aprovecha sobrantes entre cortinas', () => {
  const cfg = config();
  const pedido = {
    cortinas: [
      cortina({ ambiente: 'A', ancho: '150', alto: '100', telaId: 'blackout' }), // tubo 147, Ø38
      cortina({ ambiente: 'B', ancho: '150', alto: '100', telaId: 'blackout' }), // tubo 147, Ø38
      cortina({ ambiente: 'C', ancho: '150', alto: '100', telaId: 'blackout' }), // tubo 147, Ø38
      cortina({ ambiente: 'D', ancho: '150', alto: '100', telaId: 'blackout' }), // tubo 147 → 4 × 147 = 588 > 580
      cortina({ ambiente: 'E', ancho: '200', alto: '100', telaId: 'blackout' }) // tubo 197, Ø45
    ]
  };
  const res = C.calcularPedido(pedido, cfg);
  const g38 = res.planTubos.find((g) => g.diametro === 38);
  const g45 = res.planTubos.find((g) => g.diametro === 45);
  assert.equal(g38.cantidad, 2);
  assert.equal(g38.barras[0].cortes.length, 3);
  assert.equal(g38.barras[0].sobrante, 139);
  assert.equal(g45.cantidad, 1);
});

test('tubo por barra: el costo de las barras se reparte y suma exacto', () => {
  const cfg = config({ tuboModo: 'barra' });
  const pedido = {
    cortinas: [
      cortina({ ancho: '150', alto: '100', telaId: 'blackout' }),
      cortina({ ancho: '120', alto: '100', telaId: 'blackout' }),
      cortina({ ancho: '100,5', alto: '100', telaId: 'blackout' })
    ]
  };
  const res = C.calcularPedido(pedido, cfg);
  const totalTubos = res.items.reduce((s, it) => s + it.r.costos.tubo, 0);
  assert.equal(totalTubos, 5.8 * 6000); // 1 barra de 5,8 m a $ 6.000/m
  res.items.forEach((it) => {
    assert.equal(it.r.tuboInfo.modo, 'barra');
    // El precio se recalculó con el tubo nuevo.
    assert.equal(it.r.precio, Math.round(it.r.costoTotal * 1.6));
  });
  // Una sola cortina paga la barra entera.
  const sola = C.calcularPedido({ cortinas: [pedido.cortinas[0]] }, cfg);
  assert.equal(sola.items[0].r.costos.tubo, 34800);
});

test('tubo más largo que la barra: avisa', () => {
  const cfg = config({ largoBarra: 300 });
  const res = C.calcularPedido({ cortinas: [cortina({ ancho: '320', alto: '100', telaId: 'blackout' })] }, cfg);
  assert.ok(res.items[0].r.avisos.some((a) => /más largo que la barra/.test(a)));
  assert.equal(res.planTubos[0].largas.length, 1);
});

test('presupuesto: muestra precios y total, nunca costos ni margen', () => {
  const cfg = config();
  const txt = C.textoPresupuesto({
    fecha: '2026-10-06T12:00:00Z',
    cliente: { nombre: 'Ana' },
    cortinas: [cortina({ ambiente: 'Living', ancho: '150', alto: '180', telaId: 'blackout' })]
  }, cfg);
  assert.match(txt, /Living/);
  assert.match(txt, /\$ 130\.243/);
  assert.match(txt, /TOTAL: \$ 130\.243/);
  assert.match(txt, /válido por 15 días/);
  assert.doesNotMatch(txt, /costo|margen|81\.402/i);
});

test('normalizarConfig: marca campos vacíos y negativos', () => {
  const raw = C.clonar(C.DEFAULT_CONFIG);
  raw.contrapesoMetro = '';
  raw.telas[0].precioM2 = '-5';
  raw.largoBarra = '0';
  const { errores } = C.normalizarConfig(raw);
  const rutas = errores.map((e) => e.ruta);
  assert.ok(rutas.includes('contrapesoMetro'));
  assert.ok(rutas.includes('telas.0.precioM2'));
  assert.ok(rutas.includes('largoBarra'));
});

test('config vieja (sin campos nuevos) sigue funcionando', () => {
  const vieja = C.clonar(C.DEFAULT_CONFIG);
  delete vieja.tuboModo; delete vieja.telaModo; delete vieja.redondeo; delete vieja.tresPuntos;
  vieja.telas.forEach((t) => delete t.rotable);
  vieja.largoBarra = 580; vieja.desperdicioTela = 0;
  const { cfg, errores } = C.normalizarConfig(vieja);
  assert.deepEqual(errores, []);
  assert.equal(cfg.tuboModo, 'metro');
  assert.equal(cfg.telaModo, 'facturable');
  assert.equal(cfg.redondeo, 0);
});

test('tela favorita: la cortina nueva usa la tela pedida si existe', () => {
  const cfg = config();
  assert.equal(C.nuevaCortina(cfg, { telaId: 'sunscreen' }).telaId, 'sunscreen');
  assert.equal(C.nuevaCortina(cfg, { telaId: 'borrada' }).telaId, 'screen5');
  assert.equal(C.nuevoPedido(cfg, { modo: 'medicion' }).estado, 'Medición');
  assert.equal(C.nuevoPedido(cfg).estado, 'Presupuestado');
});

test('explicación de fórmulas coincide con el cálculo', () => {
  const cfg = config({ redondeo: 500 });
  const c = cortina({ ancho: '150', alto: '180', telaId: 'blackout' });
  const ex = C.explicarCortina(c, cfg);
  assert.equal(ex.ok, true);
  assert.equal(ex.pasos[ex.pasos.length - 1].resultado, '$ 130.500');
});

test('PWA: todos los archivos del service worker existen', () => {
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  const lista = sw.match(/const ASSETS = \[([\s\S]*?)\]/)[1].match(/'\.\/[^']*'/g).map((s) => s.slice(3, -1));
  lista.filter(Boolean).forEach((f) => assert.ok(fs.existsSync(path.join(RAIZ, f)), 'falta ' + f));
  // Y todo lo que carga index.html está en la lista.
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)].map((m) => m[1]);
  refs.forEach((f) => assert.ok(lista.includes(f), f + ' no está en ASSETS de sw.js'));
});

test('Publicación: el workflow copia exactamente los archivos del service worker', () => {
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  const assets = sw.match(/const ASSETS = \[([\s\S]*?)\]/)[1].match(/'\.\/[^']*'/g)
    .map((s) => s.slice(3, -1)).filter(Boolean).sort();
  const wf = fs.readFileSync(path.join(RAIZ, '.github/workflows/publicar.yml'), 'utf8');
  const copiados = wf.match(/^\s*cp (.+) "\$SITIO\/"$/m)[1].trim().split(/\s+/).sort();
  // sw.js se publica pero no se guarda a sí mismo en la caché.
  assert.deepEqual(copiados, assets.concat('sw.js').sort());
  // La línea que el workflow reemplaza existe tal cual.
  assert.match(sw, /^const CACHE = '[^']+';$/m);
});
