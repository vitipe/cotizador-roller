/* =====================================================================
   calc.js — Lógica de cálculo del Cotizador Roller
   ---------------------------------------------------------------------
   Este archivo NO toca la interfaz (no usa el DOM). Acá están:
     · la configuración de ejemplo (valores iniciales),
     · las medidas finales (1 o 3 puntos),
     · las fórmulas de corte y de costo,
     · el plan de corte de tubos en barras,
     · los formatos de números, medidas y pesos,
     · el armado del texto del presupuesto y de la hoja de corte.
   Si hay que cambiar cómo se calcula algo, se cambia acá.
   Funciona en el navegador (window.Calc) y en Node (module.exports).
   Las pruebas automáticas están en tests/calc.test.js.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
     1. Configuración de ejemplo
     Todos los valores son de ejemplo y se editan desde la pestaña
     "Configuración". Precios en pesos, medidas en cm.
     ------------------------------------------------------------------ */
  const DEFAULT_CONFIG = {
    version: 2,
    // rotable: la tela se puede cortar girada (el alto a lo ancho del rollo).
    telas: [
      { id: 'screen5', nombre: 'Screen 5%', precioM2: 18000, anchoRollo: 250, rotable: false },
      { id: 'blackout', nombre: 'Blackout', precioM2: 15000, anchoRollo: 300, rotable: true },
      { id: 'sunscreen', nombre: 'Sunscreen', precioM2: 21000, anchoRollo: 250, rotable: false }
    ],
    telaModo: 'facturable',  // cómo se cobra la tela (ver MODOS_TELA)
    desperdicioTela: 0,      // % extra de tela por desperdicio
    // Rangos por ancho de cortina. hastaAncho = null significa "sin límite".
    mecanismos: [
      { id: 'm38', hastaAncho: 150, diametro: 38, costoMecanismo: 9000, costoTuboMetro: 6000 },
      { id: 'm45', hastaAncho: 250, diametro: 45, costoMecanismo: 12000, costoTuboMetro: 8500 },
      { id: 'm50', hastaAncho: null, diametro: 50, costoMecanismo: 16000, costoTuboMetro: 11000 }
    ],
    tuboModo: 'metro',       // cómo se cobra el tubo (ver MODOS_TUBO)
    largoBarra: 580,         // cm de cada barra de tubo
    contrapesoMetro: 4500,   // $ por metro de contrapeso
    cadenaMetro: 1200,       // $ por metro de cadena
    cadenaFactor: 0.7,       // largo de cadena = alto × factor
    descuentos: {
      telaAncho: 4,          // cm que se descuentan al ancho para cortar la tela
      tuboLargo: 3,          // cm que se descuentan al ancho para cortar el tubo
      contrapesoLargo: 4     // cm que se descuentan al ancho para cortar el contrapeso
    },
    agregadoAlto: 20,        // cm de tela extra en el alto (enrollar + bolsillo)
    manoObra: 10000,         // $ fijo por cortina
    margen: 60,              // % de recargo sobre el costo
    minimoM2: 1,             // m² mínimos que se cobran por cortina
    redondeo: 0,             // redondear el precio hacia arriba a este múltiplo (0 = no)
    tresPuntos: false,       // cortinas nuevas con medición en 3 puntos
    // Costos extra definidos por el usuario.
    // tipo: 'fijo' (por cortina) | 'm2' (por m² facturable)
    //       'metroAncho' (por metro de ancho) | 'metroAlto' (por metro de alto)
    adicionales: [
      { id: 'instalacion', nombre: 'Instalación', tipo: 'fijo', valor: 5000, activo: true },
      { id: 'terminaciones', nombre: 'Cinta y terminaciones', tipo: 'metroAncho', valor: 800, activo: false }
    ],
    negocio: {
      nombre: 'Cortinas Roller',
      telefono: '',
      validezDias: 15
    }
  };

  const TIPOS_ADICIONAL = {
    fijo: 'Fijo por cortina',
    m2: 'Por m² facturable',
    metroAncho: 'Por metro de ancho',
    metroAlto: 'Por metro de alto'
  };

  const MODOS_TELA = {
    facturable: 'Por m² facturables (ancho × alto)',
    corte: 'Por tela cortada (con descuento y agregado)',
    rollo: 'Por ancho de rollo completo (el sobrante se pierde)'
  };

  const MODOS_TUBO = {
    metro: 'Por metro usado',
    barra: 'Por barra entera (se reparte entre las cortinas del pedido)'
  };

  const REDONDEOS = [0, 100, 500, 1000, 5000];

  // "Medición" = medido en obra, todavía sin cotizar.
  const ESTADOS = ['Medición', 'Presupuestado', 'Confirmado', 'En producción', 'Instalado'];
  const ESTADO_MEDICION = 'Medición';
  const ESTADO_INICIAL = 'Presupuestado';

  /* ------------------------------------------------------------------
     2. Números y formatos
     ------------------------------------------------------------------ */

  /**
   * Convierte lo que escribe el usuario en número.
   * Acepta "150", "150,5", "150.5", "12.000", "1.234,50", "$ 12.000".
   * Devuelve NaN si está vacío o no es un número.
   */
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    let s = String(v).replace(/[\s$]/g, '');
    if (s === '') return NaN;
    if (s.includes(',')) {
      // Formato argentino: los puntos son miles y la coma es decimal.
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
      // "12.000" o "1.234.567": puntos de miles sin decimales.
      s = s.replace(/\./g, '');
    }
    if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.?$/.test(s)) return NaN;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Igual que num() pero devuelve `def` (0 por defecto) si no es válido. */
  function numOr(v, def) {
    const n = num(v);
    return Number.isNaN(n) ? (def === undefined ? 0 : def) : n;
  }

  function vacio(v) {
    return String(v === null || v === undefined ? '' : v).trim() === '';
  }

  /** Redondea a 0,1 (para cortes en cm). */
  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  /** Redondea a pesos enteros. */
  function roundPesos(x) {
    return Math.round(x);
  }

  /** Redondea un precio hacia arriba al múltiplo indicado (0 = sin redondeo). */
  function redondearPrecio(precio, paso) {
    return paso > 0 ? Math.ceil(precio / paso) * paso : precio;
  }

  function miles(entero) {
    return String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** Número con formato argentino: 1.234,5 (hasta `dec` decimales, sin ceros de más). */
  function fmtNum(n, dec) {
    if (!Number.isFinite(n)) return '–';
    const d = dec === undefined ? 1 : dec;
    const f = Math.pow(10, d);
    const r = Math.round(n * f) / f;
    const neg = r < 0;
    const [ent, frac] = Math.abs(r).toFixed(d).split('.');
    const fracLimpia = frac ? frac.replace(/0+$/, '') : '';
    return (neg ? '-' : '') + miles(ent) + (fracLimpia ? ',' + fracLimpia : '');
  }

  /** Pesos con formato argentino: $ 1.234.567 */
  function fmtPesos(n) {
    if (!Number.isFinite(n)) return '$ –';
    const r = Math.round(n);
    return (r < 0 ? '-$ ' : '$ ') + miles(Math.abs(r));
  }

  /** Medida en cm: 123,4 cm */
  function fmtCm(n) {
    return fmtNum(n, 1) + ' cm';
  }

  /** m² con 2 decimales: 1,35 m² */
  function fmtM2(n) {
    return fmtNum(n, 2) + ' m²';
  }

  /** Fecha corta dd/mm/aaaa */
  function fmtFecha(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const p = (x) => String(x).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function plural(n, uno, varios) {
    return n + ' ' + (n === 1 ? uno : varios);
  }

  /** Id corto y único para telas, cortinas, pedidos, etc. */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* ------------------------------------------------------------------
     3. Configuración: normalizar y validar
     La interfaz guarda lo que escribe el usuario (texto). Antes de
     calcular se pasa todo a números con normalizarConfig().
     ------------------------------------------------------------------ */

  /**
   * Devuelve una copia de la config con todos los campos numéricos
   * convertidos a número (los inválidos quedan en 0) y una lista de
   * errores con la ruta del campo, para marcarlo en pantalla.
   */
  function normalizarConfig(raw) {
    const c = raw || {};
    const errores = [];

    function campo(valor, ruta, etiqueta, opciones) {
      const o = opciones || {};
      const n = num(valor);
      if (Number.isNaN(n)) {
        if (o.vacioValido) return null;
        errores.push({ ruta, msg: etiqueta + ': falta un número válido' });
        return 0;
      }
      if (n < 0) {
        errores.push({ ruta, msg: etiqueta + ': no puede ser negativo' });
        return 0;
      }
      if (o.mayorACero && n === 0) {
        errores.push({ ruta, msg: etiqueta + ': tiene que ser mayor a 0' });
      }
      return n;
    }

    const telas = (Array.isArray(c.telas) ? c.telas : []).map((t, i) => {
      const nombre = String((t && t.nombre) || '').trim();
      const etq = 'Tela ' + (nombre || '#' + (i + 1));
      if (!nombre) errores.push({ ruta: 'telas.' + i + '.nombre', msg: etq + ': falta el nombre' });
      return {
        id: (t && t.id) || uid(),
        nombre: nombre || 'Tela ' + (i + 1),
        precioM2: campo(t && t.precioM2, 'telas.' + i + '.precioM2', etq + ' › precio por m²'),
        anchoRollo: campo(t && t.anchoRollo, 'telas.' + i + '.anchoRollo', etq + ' › ancho de rollo', { mayorACero: true }),
        rotable: !!(t && t.rotable)
      };
    });
    if (!telas.length) errores.push({ ruta: 'telas', msg: 'Tiene que haber al menos una tela' });

    const mecanismos = (Array.isArray(c.mecanismos) ? c.mecanismos : []).map((m, i) => {
      const etq = 'Mecanismo #' + (i + 1);
      return {
        id: (m && m.id) || uid(),
        hastaAncho: campo(m && m.hastaAncho, 'mecanismos.' + i + '.hastaAncho', etq + ' › hasta', { vacioValido: true }),
        diametro: campo(m && m.diametro, 'mecanismos.' + i + '.diametro', etq + ' › diámetro del tubo', { mayorACero: true }),
        costoMecanismo: campo(m && m.costoMecanismo, 'mecanismos.' + i + '.costoMecanismo', etq + ' › costo del mecanismo'),
        costoTuboMetro: campo(m && m.costoTuboMetro, 'mecanismos.' + i + '.costoTuboMetro', etq + ' › costo del tubo por metro')
      };
    });
    if (!mecanismos.length) errores.push({ ruta: 'mecanismos', msg: 'Tiene que haber al menos un rango de mecanismo' });

    const adicionales = (Array.isArray(c.adicionales) ? c.adicionales : []).map((a, i) => {
      const nombre = String((a && a.nombre) || '').trim();
      const etq = 'Adicional ' + (nombre || '#' + (i + 1));
      if (!nombre) errores.push({ ruta: 'adicionales.' + i + '.nombre', msg: etq + ': falta el nombre' });
      return {
        id: (a && a.id) || uid(),
        nombre: nombre || 'Adicional ' + (i + 1),
        tipo: TIPOS_ADICIONAL[a && a.tipo] ? a.tipo : 'fijo',
        valor: campo(a && a.valor, 'adicionales.' + i + '.valor', etq + ' › valor'),
        activo: !!(a && a.activo)
      };
    });

    const redondeo = num(c.redondeo);
    const d = c.descuentos || {};
    const n = c.negocio || {};
    const cfg = {
      version: DEFAULT_CONFIG.version,
      telas,
      telaModo: MODOS_TELA[c.telaModo] ? c.telaModo : 'facturable',
      desperdicioTela: campo(c.desperdicioTela, 'desperdicioTela', 'Desperdicio de tela'),
      mecanismos,
      tuboModo: MODOS_TUBO[c.tuboModo] ? c.tuboModo : 'metro',
      largoBarra: campo(c.largoBarra, 'largoBarra', 'Largo de barra de tubo', { mayorACero: true }),
      contrapesoMetro: campo(c.contrapesoMetro, 'contrapesoMetro', 'Contrapeso › costo por metro'),
      cadenaMetro: campo(c.cadenaMetro, 'cadenaMetro', 'Cadena › costo por metro'),
      cadenaFactor: campo(c.cadenaFactor, 'cadenaFactor', 'Cadena › factor de largo'),
      descuentos: {
        telaAncho: campo(d.telaAncho, 'descuentos.telaAncho', 'Descuento al ancho de tela'),
        tuboLargo: campo(d.tuboLargo, 'descuentos.tuboLargo', 'Descuento al largo de tubo'),
        contrapesoLargo: campo(d.contrapesoLargo, 'descuentos.contrapesoLargo', 'Descuento al largo de contrapeso')
      },
      agregadoAlto: campo(c.agregadoAlto, 'agregadoAlto', 'Agregado de tela en alto'),
      manoObra: campo(c.manoObra, 'manoObra', 'Mano de obra'),
      margen: campo(c.margen, 'margen', 'Margen de ganancia'),
      minimoM2: campo(c.minimoM2, 'minimoM2', 'Mínimo facturable'),
      redondeo: REDONDEOS.includes(redondeo) ? redondeo : 0,
      tresPuntos: !!c.tresPuntos,
      adicionales,
      negocio: {
        nombre: String(n.nombre || '').trim(),
        telefono: String(n.telefono || '').trim(),
        validezDias: Math.round(campo(n.validezDias, 'negocio.validezDias', 'Validez del presupuesto'))
      }
    };
    return { cfg, errores };
  }

  /* ------------------------------------------------------------------
     4. Medidas finales (1 o 3 puntos)
     Con 3 puntos se mide el ancho arriba/medio/abajo y el alto
     izquierda/centro/derecha:
       · dentro del vano → la medida MÁS CHICA (para que entre),
       · fuera del vano  → la medida MÁS GRANDE (para que tape).
     ------------------------------------------------------------------ */

  function resolverMedida(valores, criterio) {
    const llenos = (valores || []).filter((v) => !vacio(v));
    if (!llenos.length) return { valor: NaN, estado: 'vacio' };
    const nums = llenos.map(num);
    if (nums.some((x) => Number.isNaN(x))) return { valor: NaN, estado: 'invalido' };
    const valor = criterio === 'max' ? Math.max.apply(null, nums) : Math.min.apply(null, nums);
    return { valor, estado: valor > 0 ? 'ok' : 'noPositivo', puntos: nums.length };
  }

  /**
   * Medidas finales de una cortina.
   * @returns { ok, ancho, alto, tresPuntos, criterio: 'min'|'max', errores[] }
   */
  function medidasFinales(cortina) {
    const c = cortina || {};
    const tres = !!c.tresPuntos;
    const criterio = c.colocacion === 'fuera' ? 'max' : 'min';
    const a = resolverMedida(tres ? c.anchos : [c.ancho], criterio);
    const h = resolverMedida(tres ? c.altos : [c.alto], criterio);
    const errores = [];
    [[a, 'ancho'], [h, 'alto']].forEach(([m, nombre]) => {
      if (m.estado === 'vacio') errores.push('Falta el ' + nombre);
      else if (m.estado === 'invalido') errores.push((tres ? 'Alguna medida del ' : 'El ') + nombre + ' no es un número válido');
      else if (m.estado === 'noPositivo') errores.push('El ' + nombre + ' tiene que ser mayor a 0');
    });
    return { ok: !errores.length, ancho: a.valor, alto: h.valor, tresPuntos: tres, criterio, errores };
  }

  /** Texto que explica qué medida se tomó con 3 puntos. */
  function txtCriterio(criterio) {
    return criterio === 'max'
      ? 'la más grande de cada medida (fuera del vano)'
      : 'la más chica de cada medida (dentro del vano)';
  }

  /* ------------------------------------------------------------------
     5. Cálculo por cortina
     ------------------------------------------------------------------ */

  /**
   * Elige el mecanismo según el ancho: el primer rango (de menor a mayor)
   * cuyo "hasta" sea >= ancho. Si ninguno alcanza, usa el más grande y avisa.
   */
  function elegirMecanismo(ancho, mecanismos) {
    const lista = (mecanismos || []).slice().sort((a, b) => {
      const ha = a.hastaAncho === null ? Infinity : a.hastaAncho;
      const hb = b.hastaAncho === null ? Infinity : b.hastaAncho;
      return ha - hb;
    });
    if (!lista.length) return { mec: null, fueraDeRango: false };
    for (const m of lista) {
      const hasta = m.hastaAncho === null ? Infinity : m.hastaAncho;
      if (ancho <= hasta) return { mec: m, fueraDeRango: false };
    }
    return { mec: lista[lista.length - 1], fueraDeRango: true };
  }

  /** Monto de un costo adicional según su tipo. */
  function montoAdicional(a, ancho, alto, m2Fact) {
    switch (a.tipo) {
      case 'm2': return a.valor * m2Fact;
      case 'metroAncho': return a.valor * (ancho / 100);
      case 'metroAlto': return a.valor * (alto / 100);
      default: return a.valor; // fijo por cortina
    }
  }

  /** Suma los costos y calcula el precio de venta (margen + redondeo). */
  function totalizar(r, cfg) {
    const k = r.costos;
    r.costoTotal =
      k.tela + k.tubo + k.mecanismo + k.contrapeso + k.cadena + k.manoObra +
      k.adicionales.reduce((s, a) => s + a.monto, 0);
    // Margen = recargo sobre el costo.
    r.precioSinRedondeo = roundPesos(r.costoTotal * (1 + cfg.margen / 100));
    r.precio = redondearPrecio(r.precioSinRedondeo, cfg.redondeo);
    return r;
  }

  /**
   * Calcula una cortina sola. El tubo se calcula por metro; si la config
   * cobra por barra, calcularPedido() lo recalcula con todo el pedido.
   * @param {object} cortina  { ambiente, ancho, alto | tresPuntos, anchos[], altos[], telaId, comando, colocacion, nota }
   * @param {object} cfg      config YA normalizada (ver normalizarConfig)
   * @returns {object} { ok, errores[], avisos[], notas[], medidas, cortes, costos, costoTotal, precio, ... }
   *  ok = false si faltan datos: en ese caso no suma al total del pedido.
   */
  function calcularCortina(cortina, cfg) {
    const c = cortina || {};
    const medidas = medidasFinales(c);
    const errores = medidas.errores.slice();
    const avisos = [];
    const notas = [];

    const tela = (cfg.telas || []).find((t) => t.id === c.telaId) || null;
    if (!tela) errores.push('Elegí una tela');

    const base = { ok: false, errores, avisos, notas, tela, mecanismo: null, medidas };
    if (errores.length) return base;

    const ancho = medidas.ancho;
    const alto = medidas.alto;

    // --- Superficie ---
    const m2Reales = (ancho * alto) / 10000;
    const m2Fact = Math.max(m2Reales, cfg.minimoM2);

    // --- Mecanismo / tubo según el ancho ---
    const { mec, fueraDeRango } = elegirMecanismo(ancho, cfg.mecanismos);
    if (!mec) {
      errores.push('No hay mecanismos cargados en Configuración');
      return base;
    }
    base.mecanismo = mec;
    if (fueraDeRango) {
      avisos.push('El ancho supera el rango más grande de mecanismos (hasta ' + fmtCm(mec.hastaAncho) + ')');
    }

    // --- Cortes (redondeados a 0,1 cm) ---
    const cortes = {
      telaAncho: round1(ancho - cfg.descuentos.telaAncho),
      telaLargo: round1(alto + cfg.agregadoAlto),
      tubo: round1(ancho - cfg.descuentos.tuboLargo),
      contrapeso: round1(ancho - cfg.descuentos.contrapesoLargo),
      cadena: round1(alto * cfg.cadenaFactor)
    };
    if (cortes.telaAncho <= 0 || cortes.tubo <= 0 || cortes.contrapeso <= 0) {
      errores.push('El ancho es muy chico para los descuentos de fabricación');
      return base;
    }

    // --- Orientación de la tela ---
    // Si el ancho no entra en el rollo pero el largo sí, y la tela se puede
    // girar, se corta girada: el largo va a lo ancho del rollo.
    let rotada = false;
    if (cortes.telaAncho > tela.anchoRollo) {
      if (tela.rotable && cortes.telaLargo <= tela.anchoRollo) {
        rotada = true;
        notas.push('La tela se corta girada: el largo (' + fmtCm(cortes.telaLargo) +
          ') va a lo ancho del rollo (' + fmtCm(tela.anchoRollo) + ').');
      } else {
        avisos.push('El ancho de corte (' + fmtCm(cortes.telaAncho) + ') supera el ancho de rollo de ' +
          tela.nombre + ' (' + fmtCm(tela.anchoRollo) + ')');
        if (cortes.telaLargo <= tela.anchoRollo) {
          avisos.push('Se podría cortar girada: si ' + tela.nombre + ' lo permite, activalo en Configuración → Telas.');
        }
      }
    }
    // Cuántos cm de rollo se consumen a lo largo.
    const consumoRollo = rotada ? cortes.telaAncho : cortes.telaLargo;

    // --- m² de tela que se cobran (según Configuración) ---
    const m2Corte = (cortes.telaAncho * cortes.telaLargo) / 10000;
    const m2Rollo = (tela.anchoRollo * consumoRollo) / 10000;
    const m2Base = cfg.telaModo === 'corte' ? m2Corte : cfg.telaModo === 'rollo' ? m2Rollo : m2Reales;
    const m2Tela = Math.max(m2Base, cfg.minimoM2) * (1 + cfg.desperdicioTela / 100);

    // --- Costos (cada ítem redondeado a pesos enteros) ---
    const adicionales = (cfg.adicionales || [])
      .filter((a) => a.activo)
      .map((a) => ({ id: a.id, nombre: a.nombre, monto: roundPesos(montoAdicional(a, ancho, alto, m2Fact)) }));

    const costos = {
      tela: roundPesos(m2Tela * tela.precioM2),
      tubo: roundPesos((cortes.tubo / 100) * mec.costoTuboMetro),
      mecanismo: roundPesos(mec.costoMecanismo),
      contrapeso: roundPesos((cortes.contrapeso / 100) * cfg.contrapesoMetro),
      cadena: roundPesos((cortes.cadena / 100) * cfg.cadenaMetro),
      manoObra: roundPesos(cfg.manoObra),
      adicionales
    };

    return totalizar({
      ok: true,
      errores,
      avisos,
      notas,
      medidas,
      ancho,
      alto,
      tela,
      mecanismo: mec,
      m2Reales,
      m2Fact,
      m2Corte,
      m2Rollo,
      m2Tela,
      rotada,
      consumoRollo,
      cortes,
      costos,
      tuboInfo: { modo: 'metro' }
    }, cfg);
  }

  /* ------------------------------------------------------------------
     6. Plan de corte de tubos en barras
     Agrupa los cortes de tubo por diámetro y precio y los acomoda en
     barras (primero los más largos, cada uno en la primera barra donde
     entre). Así se aprovechan los sobrantes entre cortinas del pedido.
     ------------------------------------------------------------------ */

  function planCorteTubos(items, largoBarra) {
    const grupos = {};
    items.forEach((it) => {
      if (!it.r.ok) return;
      const m = it.r.mecanismo;
      const clave = m.diametro + '|' + m.costoTuboMetro;
      if (!grupos[clave]) grupos[clave] = { diametro: m.diametro, precioMetro: m.costoTuboMetro, piezas: [] };
      grupos[clave].piezas.push({ largo: it.r.cortes.tubo, item: it, larga: !(largoBarra > 0) || it.r.cortes.tubo > largoBarra });
    });

    return Object.keys(grupos).map((clave) => {
      const g = grupos[clave];
      const barras = [];
      g.piezas
        .filter((p) => !p.larga)
        .sort((a, b) => b.largo - a.largo)
        .forEach((p) => {
          let barra = barras.find((b) => b.usado + p.largo <= largoBarra + 1e-9);
          if (!barra) {
            barra = { cortes: [], usado: 0 };
            barras.push(barra);
          }
          barra.cortes.push({ largo: p.largo, ambiente: p.item.nombre });
          barra.usado = round1(barra.usado + p.largo);
        });
      barras.forEach((b) => { b.sobrante = round1(largoBarra - b.usado); });
      const largas = g.piezas.filter((p) => p.larga);
      return {
        diametro: g.diametro,
        precioMetro: g.precioMetro,
        piezas: g.piezas,
        barras,
        cantidad: barras.length,
        largas: largas.map((p) => ({ largo: p.largo, ambiente: p.item.nombre })),
        metrosUsados: round1(g.piezas.reduce((s, p) => s + p.largo, 0))
      };
    }).sort((a, b) => a.diametro - b.diametro);
  }

  /**
   * Cobra el tubo por barra entera: el costo de las barras de cada grupo
   * se reparte entre las cortinas en proporción al largo de su tubo.
   * Los tubos más largos que una barra se cobran por metro (pedido especial).
   */
  function aplicarCostoPorBarra(plan, largoBarra, cfg) {
    plan.forEach((g) => {
      const normales = g.piezas.filter((p) => !p.larga);
      const totalLargo = normales.reduce((s, p) => s + p.largo, 0);
      const costoBarras = roundPesos(g.cantidad * (largoBarra / 100) * g.precioMetro);
      g.costoBarras = costoBarras;
      let asignado = 0;
      normales.forEach((p, i) => {
        const parte = i === normales.length - 1
          ? costoBarras - asignado
          : roundPesos(costoBarras * p.largo / totalLargo);
        asignado += parte;
        const r = p.item.r;
        r.costos.tubo = parte;
        r.tuboInfo = { modo: 'barra', barras: g.cantidad, cortinas: normales.length, largoBarra };
        totalizar(r, cfg);
      });
    });
  }

  /* ------------------------------------------------------------------
     7. Cálculo del pedido completo
     ------------------------------------------------------------------ */

  function nombreAmbiente(cortina, i) {
    const a = String((cortina && cortina.ambiente) || '').trim();
    return a || 'Cortina ' + (i + 1);
  }

  function calcularPedido(pedido, cfg) {
    const cortinas = (pedido && Array.isArray(pedido.cortinas)) ? pedido.cortinas : [];
    const items = cortinas.map((cortina, i) => ({
      cortina,
      nombre: nombreAmbiente(cortina, i),
      r: calcularCortina(cortina, cfg)
    }));

    const planTubos = planCorteTubos(items, cfg.largoBarra);
    planTubos.forEach((g) => g.piezas.forEach((p) => {
      if (p.larga && cfg.largoBarra > 0) {
        p.item.r.avisos.push('El tubo (' + fmtCm(p.largo) + ') es más largo que la barra (' +
          fmtCm(cfg.largoBarra) + '): hay que pedirlo especial.');
      }
    }));
    if (cfg.tuboModo === 'barra') aplicarCostoPorBarra(planTubos, cfg.largoBarra, cfg);

    const completas = items.filter((it) => it.r.ok);
    return {
      items,
      planTubos,
      completas: completas.length,
      incompletas: items.length - completas.length,
      costoTotal: completas.reduce((s, it) => s + it.r.costoTotal, 0),
      total: completas.reduce((s, it) => s + it.r.precio, 0)
    };
  }

  /* ------------------------------------------------------------------
     8. Salidas: presupuesto, hoja de corte, explicación de fórmulas
     ------------------------------------------------------------------ */

  function txtComando(v) {
    return v === 'izquierda' ? 'izquierda' : 'derecha';
  }

  function txtColocacion(v) {
    return v === 'fuera' ? 'fuera del vano' : 'dentro del vano';
  }

  /**
   * Texto para pegar en WhatsApp. Usa *negrita* de WhatsApp.
   * NO incluye costos ni margen: solo precios de venta.
   */
  function textoPresupuesto(pedido, cfg) {
    const res = calcularPedido(pedido, cfg);
    const neg = cfg.negocio || {};
    const cli = (pedido && pedido.cliente) || {};
    const lineas = [];

    lineas.push('*' + (neg.nombre || 'Presupuesto de cortinas roller') + '*');
    lineas.push('Presupuesto de cortinas roller');
    lineas.push('Fecha: ' + fmtFecha(pedido && pedido.fecha));
    if (cli.nombre) lineas.push('Cliente: ' + String(cli.nombre).trim());
    lineas.push('');

    let n = 0;
    res.items.forEach((it) => {
      if (!it.r.ok) return;
      n++;
      const r = it.r;
      lineas.push('*' + n + '. ' + it.nombre + '*');
      lineas.push('Medidas: ' + fmtNum(r.ancho) + ' × ' + fmtNum(r.alto) + ' cm (ancho × alto)');
      lineas.push('Tela: ' + r.tela.nombre);
      lineas.push('Comando ' + txtComando(it.cortina.comando) + ' · ' + txtColocacion(it.cortina.colocacion));
      lineas.push('Precio: ' + fmtPesos(r.precio));
      lineas.push('');
    });

    if (!n) {
      lineas.push('(Todavía no hay cortinas completas)');
      lineas.push('');
    }

    lineas.push('*TOTAL: ' + fmtPesos(res.total) + '*');
    lineas.push('');
    const dias = Number(neg.validezDias) || 0;
    if (dias > 0) lineas.push('Presupuesto válido por ' + dias + ' día' + (dias === 1 ? '' : 's') + '.');
    if (neg.telefono) lineas.push('Consultas: ' + neg.telefono);
    lineas.push('¡Gracias por tu consulta!');
    return lineas.join('\n').trim();
  }

  /** Filas para la hoja de corte del taller. */
  function filasHojaCorte(pedido, cfg, resultado) {
    const res = resultado || calcularPedido(pedido, cfg);
    return res.items.map((it) => {
      const r = it.r;
      const base = {
        ambiente: it.nombre,
        comando: txtComando(it.cortina.comando),
        colocacion: txtColocacion(it.cortina.colocacion),
        nota: String(it.cortina.nota || '').trim(),
        ok: r.ok,
        errores: r.errores,
        avisos: r.avisos,
        notas: r.notas || []
      };
      if (!r.ok) return base;
      return Object.assign(base, {
        ancho: r.ancho,
        alto: r.alto,
        tresPuntos: r.medidas.tresPuntos,
        criterio: r.medidas.criterio,
        tela: r.tela.nombre,
        telaAncho: r.cortes.telaAncho,
        telaLargo: r.cortes.telaLargo,
        rotada: r.rotada,
        consumoRollo: r.consumoRollo,
        tuboDiametro: r.mecanismo.diametro,
        tuboLargo: r.cortes.tubo,
        contrapeso: r.cortes.contrapeso,
        cadena: r.cortes.cadena
      });
    });
  }

  /**
   * Resumen de materiales para el taller: metros de rollo por tela,
   * tubos por diámetro (con barras), contrapeso y cadena totales.
   */
  function resumenMateriales(pedido, cfg, resultado) {
    const res = resultado || calcularPedido(pedido, cfg);
    const filas = filasHojaCorte(pedido, cfg, res).filter((f) => f.ok);
    const telas = {};
    let contrapeso = 0;
    let cadena = 0;
    filas.forEach((f) => {
      telas[f.tela] = (telas[f.tela] || 0) + f.consumoRollo;
      contrapeso += f.contrapeso;
      cadena += f.cadena;
    });
    return {
      telas: Object.keys(telas).map((k) => ({ nombre: k, largo: round1(telas[k]) })),
      tubos: res.planTubos.map((g) => ({ diametro: g.diametro, largo: g.metrosUsados, barras: g.cantidad, especiales: g.largas.length })),
      contrapeso: round1(contrapeso),
      cadena: round1(cadena)
    };
  }

  /**
   * Explica paso a paso cómo se calcula una cortina, con los valores
   * reemplazados. Lo usa el panel "Cómo se calcula" de Configuración.
   * Devuelve { ok, errores, pasos: [{ concepto, formula, resultado }], avisos, notas }.
   */
  function explicarCortina(cortina, cfg) {
    const res = calcularPedido({ cortinas: [cortina] }, cfg);
    const r = res.items[0].r;
    if (!r.ok) return { ok: false, errores: r.errores, pasos: [] };
    const d = cfg.descuentos;
    const N = (x) => fmtNum(x, 2);
    const pasos = [];

    if (r.medidas.tresPuntos) {
      pasos.push({ concepto: 'Medida final', formula: txtCriterio(r.medidas.criterio), resultado: fmtNum(r.ancho) + ' × ' + fmtNum(r.alto) + ' cm' });
    }
    pasos.push(
      { concepto: 'm² reales', formula: 'ancho × alto ÷ 10.000 = ' + N(r.ancho) + ' × ' + N(r.alto) + ' ÷ 10.000', resultado: fmtM2(r.m2Reales) },
      { concepto: 'm² facturables', formula: 'el mayor entre m² reales y el mínimo (' + N(cfg.minimoM2) + ' m²)', resultado: fmtM2(r.m2Fact) },
      { concepto: 'Tubo elegido', formula: 'según el ancho (' + fmtCm(r.ancho) + ')', resultado: 'Ø ' + fmtNum(r.mecanismo.diametro) + ' mm' },
      { concepto: 'Corte de tela (ancho)', formula: 'ancho − ' + N(d.telaAncho) + ' cm', resultado: fmtCm(r.cortes.telaAncho) },
      { concepto: 'Corte de tela (largo)', formula: 'alto + ' + N(cfg.agregadoAlto) + ' cm' + (r.rotada ? ' · se corta girada' : ''), resultado: fmtCm(r.cortes.telaLargo) },
      { concepto: 'Corte de tubo', formula: 'ancho − ' + N(d.tuboLargo) + ' cm', resultado: fmtCm(r.cortes.tubo) },
      { concepto: 'Corte de contrapeso', formula: 'ancho − ' + N(d.contrapesoLargo) + ' cm', resultado: fmtCm(r.cortes.contrapeso) },
      { concepto: 'Largo de cadena', formula: 'alto × ' + N(cfg.cadenaFactor), resultado: fmtCm(r.cortes.cadena) }
    );

    // Tela según el modo de cobro.
    let baseTela;
    if (cfg.telaModo === 'corte') baseTela = 'tela cortada ' + N(r.cortes.telaAncho / 100) + ' × ' + N(r.cortes.telaLargo / 100) + ' m = ' + fmtM2(r.m2Corte);
    else if (cfg.telaModo === 'rollo') baseTela = 'rollo de ' + N(r.tela.anchoRollo / 100) + ' m × ' + N(r.consumoRollo / 100) + ' m = ' + fmtM2(r.m2Rollo);
    else baseTela = 'm² facturables';
    pasos.push({
      concepto: 'm² de tela cobrados',
      formula: baseTela + ' (mínimo ' + N(cfg.minimoM2) + ' m²)' + (cfg.desperdicioTela ? ' + ' + N(cfg.desperdicioTela) + '% de desperdicio' : ''),
      resultado: fmtM2(r.m2Tela)
    });
    pasos.push({ concepto: 'Costo tela', formula: N(r.m2Tela) + ' m² × ' + fmtPesos(r.tela.precioM2) + ' (' + r.tela.nombre + ')', resultado: fmtPesos(r.costos.tela) });

    if (r.tuboInfo.modo === 'barra') {
      pasos.push({
        concepto: 'Costo tubo',
        formula: plural(r.tuboInfo.barras, 'barra', 'barras') + ' de ' + N(r.tuboInfo.largoBarra / 100) + ' m × ' +
          fmtPesos(r.mecanismo.costoTuboMetro) + ' por metro (en un pedido con varias cortinas se reparte)',
        resultado: fmtPesos(r.costos.tubo)
      });
    } else {
      pasos.push({ concepto: 'Costo tubo', formula: N(r.cortes.tubo / 100) + ' m × ' + fmtPesos(r.mecanismo.costoTuboMetro) + ' por metro', resultado: fmtPesos(r.costos.tubo) });
    }
    pasos.push(
      { concepto: 'Costo mecanismo', formula: 'fijo del rango Ø ' + fmtNum(r.mecanismo.diametro) + ' mm', resultado: fmtPesos(r.costos.mecanismo) },
      { concepto: 'Costo contrapeso', formula: N(r.cortes.contrapeso / 100) + ' m × ' + fmtPesos(cfg.contrapesoMetro) + ' por metro', resultado: fmtPesos(r.costos.contrapeso) },
      { concepto: 'Costo cadena', formula: N(r.cortes.cadena / 100) + ' m × ' + fmtPesos(cfg.cadenaMetro) + ' por metro', resultado: fmtPesos(r.costos.cadena) },
      { concepto: 'Mano de obra', formula: 'fijo por cortina', resultado: fmtPesos(r.costos.manoObra) }
    );
    r.costos.adicionales.forEach((a) => {
      const def = cfg.adicionales.find((x) => x.id === a.id);
      pasos.push({ concepto: a.nombre, formula: TIPOS_ADICIONAL[def.tipo] + ' (' + fmtPesos(def.valor) + ')', resultado: fmtPesos(a.monto) });
    });
    pasos.push({ concepto: 'Costo total', formula: 'suma de todos los costos', resultado: fmtPesos(r.costoTotal) });
    pasos.push({
      concepto: 'Precio de venta',
      formula: 'costo × (1 + ' + N(cfg.margen) + '%)' +
        (cfg.redondeo ? ' = ' + fmtPesos(r.precioSinRedondeo) + ', redondeado hacia arriba a ' + fmtPesos(cfg.redondeo) : ''),
      resultado: fmtPesos(r.precio)
    });
    return { ok: true, errores: [], pasos, avisos: r.avisos, notas: r.notas };
  }

  /* ------------------------------------------------------------------
     9. Modelos vacíos
     ------------------------------------------------------------------ */

  /**
   * Cortina nueva. opciones.telaId: tela preferida (si existe en la config).
   */
  function nuevaCortina(cfg, opciones) {
    const o = opciones || {};
    const telas = (cfg && cfg.telas) || [];
    const preferida = telas.find((t) => t.id === o.telaId) || telas[0];
    return {
      id: uid(),
      ambiente: '',
      tresPuntos: !!(cfg && cfg.tresPuntos),
      ancho: '',
      alto: '',
      anchos: ['', '', ''],
      altos: ['', '', ''],
      telaId: preferida ? preferida.id : '',
      comando: 'derecha',
      colocacion: 'dentro',
      nota: ''
    };
  }

  /**
   * Pedido nuevo. opciones.modo: 'cotizar' | 'medicion'.
   */
  function nuevoPedido(cfg, opciones) {
    const o = opciones || {};
    return {
      id: null, // se asigna al guardar
      fecha: new Date().toISOString(),
      modo: o.modo === 'medicion' ? 'medicion' : 'cotizar',
      estado: o.modo === 'medicion' ? ESTADO_MEDICION : ESTADO_INICIAL,
      sena: '',
      cliente: { nombre: '', telefono: '', direccion: '' },
      cortinas: [nuevaCortina(cfg, o)]
    };
  }

  const Calc = {
    DEFAULT_CONFIG,
    TIPOS_ADICIONAL,
    MODOS_TELA,
    MODOS_TUBO,
    REDONDEOS,
    ESTADOS,
    ESTADO_MEDICION,
    ESTADO_INICIAL,
    num,
    numOr,
    vacio,
    round1,
    roundPesos,
    redondearPrecio,
    fmtNum,
    fmtPesos,
    fmtCm,
    fmtM2,
    fmtFecha,
    plural,
    uid,
    clonar,
    normalizarConfig,
    medidasFinales,
    txtCriterio,
    elegirMecanismo,
    calcularCortina,
    planCorteTubos,
    calcularPedido,
    textoPresupuesto,
    filasHojaCorte,
    resumenMateriales,
    explicarCortina,
    nuevaCortina,
    nuevoPedido
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else global.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
