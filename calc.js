/* =====================================================================
   calc.js — Lógica de cálculo del Cotizador Roller
   ---------------------------------------------------------------------
   Este archivo NO toca la interfaz (no usa el DOM). Acá están:
     · la configuración de ejemplo (valores iniciales),
     · las fórmulas de corte y de costo,
     · los formatos de números, medidas y pesos,
     · el armado del texto del presupuesto y de la hoja de corte.
   Si hay que cambiar cómo se calcula algo, se cambia acá.
   Funciona en el navegador (window.Calc) y en Node (module.exports).
   ===================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
     1. Configuración de ejemplo
     Todos los valores son de ejemplo y se editan desde la pestaña
     "Configuración". Precios en pesos, medidas en cm.
     ------------------------------------------------------------------ */
  const DEFAULT_CONFIG = {
    version: 1,
    telas: [
      { id: 'screen5', nombre: 'Screen 5%', precioM2: 18000, anchoRollo: 250 },
      { id: 'blackout', nombre: 'Blackout', precioM2: 15000, anchoRollo: 300 },
      { id: 'sunscreen', nombre: 'Sunscreen', precioM2: 21000, anchoRollo: 250 }
    ],
    // Rangos por ancho de cortina. hastaAncho = null significa "sin límite".
    mecanismos: [
      { id: 'm38', hastaAncho: 150, diametro: 38, costoMecanismo: 9000, costoTuboMetro: 6000 },
      { id: 'm45', hastaAncho: 250, diametro: 45, costoMecanismo: 12000, costoTuboMetro: 8500 },
      { id: 'm50', hastaAncho: null, diametro: 50, costoMecanismo: 16000, costoTuboMetro: 11000 }
    ],
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

  const ESTADOS = ['Presupuestado', 'Confirmado', 'En producción', 'Instalado'];

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

  /** Redondea a 0,1 (para cortes en cm). */
  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  /** Redondea a pesos enteros. */
  function roundPesos(x) {
    return Math.round(x);
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

  /** Id corto y único para telas, cortinas, pedidos, etc. */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ------------------------------------------------------------------
     3. Configuración: normalizar y validar
     La interfaz guarda lo que escribe el usuario (texto). Antes de
     calcular se pasa todo a números con normalizarConfig().
     ------------------------------------------------------------------ */

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

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
        anchoRollo: campo(t && t.anchoRollo, 'telas.' + i + '.anchoRollo', etq + ' › ancho de rollo', { mayorACero: true })
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

    const d = c.descuentos || {};
    const n = c.negocio || {};
    const cfg = {
      version: DEFAULT_CONFIG.version,
      telas,
      mecanismos,
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
     4. Cálculo por cortina
     ------------------------------------------------------------------ */

  /**
   * Elige el mecanismo según el ancho: el primer rango (de menor a mayor)
   * cuyo "hasta" sea >= ancho. Si ninguno alcanza, usa el rango sin
   * límite; si no hay, el más grande (y avisa).
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

  /**
   * Calcula una cortina.
   * @param {object} cortina  { ambiente, ancho, alto, telaId, comando, colocacion }
   * @param {object} cfg      config YA normalizada (ver normalizarConfig)
   * @returns {object} { ok, errores[], avisos[], medidas, cortes, costos, costoTotal, precio, ... }
   *  ok = false si faltan datos: en ese caso no suma al total del pedido.
   */
  function calcularCortina(cortina, cfg) {
    const c = cortina || {};
    const errores = [];
    const avisos = [];

    const ancho = num(c.ancho);
    const alto = num(c.alto);
    const vacio = (v) => String(v === null || v === undefined ? '' : v).trim() === '';
    if (Number.isNaN(ancho)) errores.push(vacio(c.ancho) ? 'Falta el ancho' : 'El ancho no es un número válido');
    else if (ancho <= 0) errores.push('El ancho tiene que ser mayor a 0');
    if (Number.isNaN(alto)) errores.push(vacio(c.alto) ? 'Falta el alto' : 'El alto no es un número válido');
    else if (alto <= 0) errores.push('El alto tiene que ser mayor a 0');

    const tela = (cfg.telas || []).find((t) => t.id === c.telaId) || null;
    if (!tela) errores.push('Elegí una tela');

    if (errores.length) {
      return { ok: false, errores, avisos, tela, mecanismo: null };
    }

    // --- Superficie ---
    const m2Reales = (ancho * alto) / 10000;
    const m2Fact = Math.max(m2Reales, cfg.minimoM2);

    // --- Mecanismo / tubo según el ancho ---
    const { mec, fueraDeRango } = elegirMecanismo(ancho, cfg.mecanismos);
    if (!mec) {
      return { ok: false, errores: ['No hay mecanismos cargados en Configuración'], avisos, tela, mecanismo: null };
    }
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
      return {
        ok: false,
        errores: ['El ancho es muy chico para los descuentos de fabricación'],
        avisos, tela, mecanismo: mec
      };
    }

    if (cortes.telaAncho > tela.anchoRollo) {
      avisos.push(
        'El ancho de corte (' + fmtCm(cortes.telaAncho) + ') supera el ancho de rollo de ' +
        tela.nombre + ' (' + fmtCm(tela.anchoRollo) + ')'
      );
    }

    // --- Costos (cada ítem redondeado a pesos enteros) ---
    const adicionales = (cfg.adicionales || [])
      .filter((a) => a.activo)
      .map((a) => ({ id: a.id, nombre: a.nombre, monto: roundPesos(montoAdicional(a, ancho, alto, m2Fact)) }));

    const costos = {
      tela: roundPesos(m2Fact * tela.precioM2),
      tubo: roundPesos((cortes.tubo / 100) * mec.costoTuboMetro),
      mecanismo: roundPesos(mec.costoMecanismo),
      contrapeso: roundPesos((cortes.contrapeso / 100) * cfg.contrapesoMetro),
      cadena: roundPesos((cortes.cadena / 100) * cfg.cadenaMetro),
      manoObra: roundPesos(cfg.manoObra),
      adicionales
    };

    const costoTotal =
      costos.tela + costos.tubo + costos.mecanismo + costos.contrapeso +
      costos.cadena + costos.manoObra +
      adicionales.reduce((s, a) => s + a.monto, 0);

    // Margen = recargo sobre el costo.
    const precio = roundPesos(costoTotal * (1 + cfg.margen / 100));

    return {
      ok: true,
      errores,
      avisos,
      ancho,
      alto,
      tela,
      mecanismo: mec,
      m2Reales,
      m2Fact,
      cortes,
      costos,
      costoTotal,
      precio
    };
  }

  /* ------------------------------------------------------------------
     5. Cálculo del pedido completo
     ------------------------------------------------------------------ */

  function calcularPedido(pedido, cfg) {
    const cortinas = (pedido && Array.isArray(pedido.cortinas)) ? pedido.cortinas : [];
    const items = cortinas.map((cortina) => ({ cortina, r: calcularCortina(cortina, cfg) }));
    const completas = items.filter((it) => it.r.ok);
    return {
      items,
      completas: completas.length,
      incompletas: items.length - completas.length,
      costoTotal: completas.reduce((s, it) => s + it.r.costoTotal, 0),
      total: completas.reduce((s, it) => s + it.r.precio, 0)
    };
  }

  /* ------------------------------------------------------------------
     6. Salidas: presupuesto, hoja de corte, explicación de fórmulas
     ------------------------------------------------------------------ */

  function nombreAmbiente(cortina, i) {
    const a = String((cortina && cortina.ambiente) || '').trim();
    return a || 'Cortina ' + (i + 1);
  }

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
    res.items.forEach((it, i) => {
      if (!it.r.ok) return;
      n++;
      const r = it.r;
      lineas.push('*' + n + '. ' + nombreAmbiente(it.cortina, i) + '*');
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

  /** Filas para la hoja de corte del taller (solo cortinas completas). */
  function filasHojaCorte(pedido, cfg) {
    const res = calcularPedido(pedido, cfg);
    return res.items.map((it, i) => {
      const r = it.r;
      const base = {
        ambiente: nombreAmbiente(it.cortina, i),
        comando: txtComando(it.cortina.comando),
        colocacion: txtColocacion(it.cortina.colocacion),
        ok: r.ok,
        errores: r.errores,
        avisos: r.avisos
      };
      if (!r.ok) return base;
      return Object.assign(base, {
        ancho: r.ancho,
        alto: r.alto,
        tela: r.tela.nombre,
        telaAncho: r.cortes.telaAncho,
        telaLargo: r.cortes.telaLargo,
        tuboDiametro: r.mecanismo.diametro,
        tuboLargo: r.cortes.tubo,
        contrapeso: r.cortes.contrapeso,
        cadena: r.cortes.cadena
      });
    });
  }

  /**
   * Resumen de materiales para el taller: metros de tela por tipo,
   * metros de tubo por diámetro, contrapeso y cadena totales.
   */
  function resumenMateriales(pedido, cfg) {
    const filas = filasHojaCorte(pedido, cfg).filter((f) => f.ok);
    const telas = {};
    const tubos = {};
    let contrapeso = 0;
    let cadena = 0;
    filas.forEach((f) => {
      telas[f.tela] = (telas[f.tela] || 0) + f.telaLargo;
      tubos[f.tuboDiametro] = (tubos[f.tuboDiametro] || 0) + f.tuboLargo;
      contrapeso += f.contrapeso;
      cadena += f.cadena;
    });
    return {
      telas: Object.keys(telas).map((k) => ({ nombre: k, largo: round1(telas[k]) })),
      tubos: Object.keys(tubos).map((k) => ({ diametro: Number(k), largo: round1(tubos[k]) })),
      contrapeso: round1(contrapeso),
      cadena: round1(cadena)
    };
  }

  /**
   * Explica paso a paso cómo se calcula una cortina, con los valores
   * reemplazados. Lo usa el panel "Cómo se calcula" de Configuración.
   * Devuelve [{ concepto, formula, resultado }].
   */
  function explicarCortina(cortina, cfg) {
    const r = calcularCortina(cortina, cfg);
    if (!r.ok) return { ok: false, errores: r.errores, pasos: [] };
    const d = cfg.descuentos;
    const N = (x) => fmtNum(x, 2);
    const pasos = [
      { concepto: 'm² reales', formula: 'ancho × alto ÷ 10.000 = ' + N(r.ancho) + ' × ' + N(r.alto) + ' ÷ 10.000', resultado: fmtM2(r.m2Reales) },
      { concepto: 'm² facturables', formula: 'el mayor entre m² reales y el mínimo (' + N(cfg.minimoM2) + ' m²)', resultado: fmtM2(r.m2Fact) },
      { concepto: 'Tubo elegido', formula: 'según el ancho (' + fmtCm(r.ancho) + ')', resultado: 'Ø ' + fmtNum(r.mecanismo.diametro) + ' mm' },
      { concepto: 'Corte de tela (ancho)', formula: 'ancho − ' + N(d.telaAncho) + ' cm', resultado: fmtCm(r.cortes.telaAncho) },
      { concepto: 'Corte de tela (largo)', formula: 'alto + ' + N(cfg.agregadoAlto) + ' cm', resultado: fmtCm(r.cortes.telaLargo) },
      { concepto: 'Corte de tubo', formula: 'ancho − ' + N(d.tuboLargo) + ' cm', resultado: fmtCm(r.cortes.tubo) },
      { concepto: 'Corte de contrapeso', formula: 'ancho − ' + N(d.contrapesoLargo) + ' cm', resultado: fmtCm(r.cortes.contrapeso) },
      { concepto: 'Largo de cadena', formula: 'alto × ' + N(cfg.cadenaFactor), resultado: fmtCm(r.cortes.cadena) },
      { concepto: 'Costo tela', formula: N(r.m2Fact) + ' m² × ' + fmtPesos(r.tela.precioM2) + ' (' + r.tela.nombre + ')', resultado: fmtPesos(r.costos.tela) },
      { concepto: 'Costo tubo', formula: N(r.cortes.tubo / 100) + ' m × ' + fmtPesos(r.mecanismo.costoTuboMetro) + ' por metro', resultado: fmtPesos(r.costos.tubo) },
      { concepto: 'Costo mecanismo', formula: 'fijo del rango Ø ' + fmtNum(r.mecanismo.diametro) + ' mm', resultado: fmtPesos(r.costos.mecanismo) },
      { concepto: 'Costo contrapeso', formula: N(r.cortes.contrapeso / 100) + ' m × ' + fmtPesos(cfg.contrapesoMetro) + ' por metro', resultado: fmtPesos(r.costos.contrapeso) },
      { concepto: 'Costo cadena', formula: N(r.cortes.cadena / 100) + ' m × ' + fmtPesos(cfg.cadenaMetro) + ' por metro', resultado: fmtPesos(r.costos.cadena) },
      { concepto: 'Mano de obra', formula: 'fijo por cortina', resultado: fmtPesos(r.costos.manoObra) }
    ];
    r.costos.adicionales.forEach((a) => {
      const def = cfg.adicionales.find((x) => x.id === a.id);
      pasos.push({ concepto: a.nombre, formula: TIPOS_ADICIONAL[def.tipo] + ' (' + fmtPesos(def.valor) + ')', resultado: fmtPesos(a.monto) });
    });
    pasos.push({ concepto: 'Costo total', formula: 'suma de todos los costos', resultado: fmtPesos(r.costoTotal) });
    pasos.push({ concepto: 'Precio de venta', formula: 'costo × (1 + ' + N(cfg.margen) + '%)', resultado: fmtPesos(r.precio) });
    return { ok: true, errores: [], pasos, avisos: r.avisos };
  }

  /* ------------------------------------------------------------------
     7. Modelos vacíos
     ------------------------------------------------------------------ */

  function nuevaCortina(cfg) {
    const primera = cfg && cfg.telas && cfg.telas[0];
    return {
      id: uid(),
      ambiente: '',
      ancho: '',
      alto: '',
      telaId: primera ? primera.id : '',
      comando: 'derecha',
      colocacion: 'dentro'
    };
  }

  function nuevoPedido(cfg) {
    return {
      id: null, // se asigna al guardar
      fecha: new Date().toISOString(),
      estado: ESTADOS[0],
      sena: '',
      cliente: { nombre: '', telefono: '', direccion: '' },
      cortinas: [nuevaCortina(cfg)]
    };
  }

  const Calc = {
    DEFAULT_CONFIG,
    TIPOS_ADICIONAL,
    ESTADOS,
    num,
    numOr,
    round1,
    roundPesos,
    fmtNum,
    fmtPesos,
    fmtCm,
    fmtM2,
    fmtFecha,
    uid,
    clonar,
    normalizarConfig,
    elegirMecanismo,
    calcularCortina,
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
