/* =====================================================================
   app.js — Interfaz del Cotizador Roller
   ---------------------------------------------------------------------
   Solo pantalla y eventos. Las cuentas están en calc.js (window.Calc)
   y el guardado en storage.js (window.Store).
   Secciones:
     1. Estado y utilidades
     2. Navegación por pestañas
     3. Nuevo pedido (modo, cortinas, totales, guardar)
     4. Presupuesto para WhatsApp
     5. Hoja de corte
     6. Pedidos guardados
     7. Configuración
     8. Instalación (PWA)
     9. Service worker y aviso de actualización
    10. Arranque
   ===================================================================== */
(function () {
  'use strict';

  const C = window.Calc;
  const S = window.Store;

  /* ==================================================================
     1. Estado y utilidades
     ================================================================== */

  const state = {
    config: S.cargarConfig(),   // config guardada (números)
    pedidos: S.cargarPedidos(), // pedidos guardados
    pedido: null,               // pedido que se está editando
    sucio: false,               // el pedido en edición tiene cambios sin guardar
    desgloseAbierto: new Set(), // cortinas con el desglose de costos abierto
    cfgDraft: null,             // copia editable de la config
    cfgSucia: false,            // hay cambios de config sin guardar
    ejemplo: { ancho: '150', alto: '180', telaId: '' }, // cortina de prueba de "Cómo se calcula"
    aumento: {                  // herramienta de aumento masivo de precios
      pct: '',
      grupos: { telas: true, tubos: true, insumos: true, manoObra: true, adicionales: true }
    },
    filtroEstado: '',
    busqueda: ''
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const plural = C.plural;

  /** Escapa texto del usuario antes de meterlo en HTML. */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Para comparar textos sin importar mayúsculas ni tildes. */
  function normalizarTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  let toastTimer = null;
  function toast(msg, tipo) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast visible' + (tipo === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
  }

  function abrirDialogo(dlg) {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function cerrarDialogo(dlg) {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  /** Copia texto al portapapeles (con alternativa para navegadores viejos). */
  function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy'));
      } catch (e) {
        reject(e);
      } finally {
        ta.remove();
      }
    });
  }

  const ICONOS = {
    duplicar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    borrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
  };

  /* ==================================================================
     2. Navegación por pestañas (#pedido, #pedidos, #config)
     ================================================================== */

  const TABS = ['pedido', 'pedidos', 'config'];
  let tabActual = null;

  function irA(tab) {
    if (!TABS.includes(tab)) tab = 'pedido';
    if (tabActual === 'config' && tab !== 'config' && state.cfgSucia) {
      toast('Ojo: no guardaste los cambios de Configuración');
    }
    tabActual = tab;
    $$('.tab').forEach((s) => { s.hidden = s.dataset.tab !== tab; });
    $$('.tabbar-item').forEach((a) => {
      if (a.dataset.ir === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (tab === 'pedidos') renderPedidos();
    if (tab === 'config') {
      if (!state.cfgDraft) state.cfgDraft = C.clonar(state.config);
      renderConfig();
    }
    window.scrollTo(0, 0);
  }

  function tabDesdeHash() {
    return (location.hash || '#pedido').slice(1);
  }

  /* ==================================================================
     3. Nuevo pedido
     ================================================================== */

  let borradorTimer = null;
  /** Guarda el pedido en edición para no perderlo si se cierra la app. */
  function guardarBorrador(inmediato) {
    clearTimeout(borradorTimer);
    const hacer = () => S.guardarBorrador(Object.assign({}, state.pedido, { _sucio: state.sucio }));
    if (inmediato) hacer();
    else borradorTimer = setTimeout(hacer, 300);
  }

  function marcarSucio() {
    state.sucio = true;
    guardarBorrador();
  }

  function modoActual() {
    return state.pedido.modo === 'medicion' ? 'medicion' : 'cotizar';
  }

  /** Última tela elegida, si todavía existe en la configuración. */
  function telaPreferida() {
    const id = S.cargarPreferencias().ultimaTela;
    return state.config.telas.some((t) => t.id === id) ? id : undefined;
  }

  function cortinaTieneDatos(c) {
    const lleno = (v) => !C.vacio(v);
    return lleno(c.ancho) || lleno(c.alto) || lleno(c.ambiente) || lleno(c.nota) ||
      (c.anchos || []).some(lleno) || (c.altos || []).some(lleno);
  }

  function pedidoTieneDatos(p) {
    if (!p) return false;
    const cli = p.cliente || {};
    if ((cli.nombre || '').trim() || (cli.telefono || '').trim()) return true;
    return (p.cortinas || []).some(cortinaTieneDatos);
  }

  /** Pregunta antes de descartar cambios sin guardar. */
  function puedeDescartarPedido() {
    if (!state.sucio || !pedidoTieneDatos(state.pedido)) return true;
    return confirm('El pedido actual tiene cambios sin guardar. ¿Seguir igual y perderlos?');
  }

  /** Completa campos que pueden faltar en pedidos guardados con versiones viejas. */
  function completarPedido(p) {
    p.cliente = Object.assign({ nombre: '', telefono: '', direccion: '' }, p.cliente);
    if (!Array.isArray(p.cortinas)) p.cortinas = [];
    p.cortinas.forEach((c) => {
      if (!Array.isArray(c.anchos)) c.anchos = ['', '', ''];
      if (!Array.isArray(c.altos)) c.altos = ['', '', ''];
      if (c.nota === undefined) c.nota = '';
    });
    if (p.modo !== 'medicion') p.modo = 'cotizar';
    return p;
  }

  function cargarPedidoEnEditor(pedido) {
    state.pedido = completarPedido(pedido);
    state.sucio = false;
    state.desgloseAbierto.clear();
    guardarBorrador(true);
    renderPedidoCompleto();
  }

  function aplicarModo() {
    const modo = modoActual();
    document.body.classList.toggle('modo-medicion', modo === 'medicion');
    $$('[data-modo]').forEach((r) => { r.checked = r.value === modo; });
  }

  function cambiarModo(modo) {
    if (modoActual() === modo) return;
    state.pedido.modo = modo;
    marcarSucio();
    aplicarModo();
    renderCortinas();
    if (modo === 'cotizar') toast('Modo cotizar: elegí la tela de cada cortina');
  }

  function renderPedidoCompleto() {
    $$('[data-cliente]').forEach((inp) => {
      inp.value = state.pedido.cliente[inp.dataset.cliente] || '';
    });
    aplicarModo();
    renderCortinas();
  }

  function opcionesTela(telaId) {
    const telas = state.config.telas;
    const existe = telas.some((t) => t.id === telaId);
    let html = existe ? '' : '<option value="" selected>Elegí una tela</option>';
    html += telas.map((t) =>
      '<option value="' + esc(t.id) + '"' + (t.id === telaId ? ' selected' : '') + '>' +
      esc(t.nombre) + ' (rollo ' + esc(C.fmtNum(t.anchoRollo)) + ' cm)</option>'
    ).join('');
    return html;
  }

  function segmentado(nombre, campo, valor, opciones) {
    return '<div class="segmentado">' + opciones.map((o) =>
      '<label><input type="radio" name="' + esc(nombre) + '" value="' + o.v + '" data-campo="' + campo + '"' +
      (valor === o.v ? ' checked' : '') + '><span>' + o.t + '</span></label>'
    ).join('') + '</div>';
  }

  function inputMedida(campo, valor, etiqueta) {
    const input = '<div class="con-unidad" data-unidad="cm"><input type="text" inputmode="decimal" data-campo="' + campo +
      '" value="' + esc(valor) + '" placeholder="0" autocomplete="off"></div>';
    return '<label class="mini"><small>' + etiqueta + '</small>' + input + '</label>';
  }

  /** Campos de medida: ancho y alto simples, o 3 puntos de cada uno. */
  function medidasHTML(c) {
    if (!c.tresPuntos) {
      return '<div class="fila">' +
        '<label class="campo"><span>Ancho</span><div class="con-unidad" data-unidad="cm">' +
          '<input type="text" inputmode="decimal" data-campo="ancho" value="' + esc(c.ancho) + '" placeholder="0" autocomplete="off"></div></label>' +
        '<label class="campo"><span>Alto</span><div class="con-unidad" data-unidad="cm">' +
          '<input type="text" inputmode="decimal" data-campo="alto" value="' + esc(c.alto) + '" placeholder="0" autocomplete="off"></div></label>' +
      '</div>';
    }
    const an = c.anchos || [];
    const al = c.altos || [];
    return '<div class="grupo-medida"><span>Ancho</span><div class="fila-3">' +
        inputMedida('anchos.0', an[0], 'Arriba') + inputMedida('anchos.1', an[1], 'Medio') + inputMedida('anchos.2', an[2], 'Abajo') +
      '</div></div>' +
      '<div class="grupo-medida"><span>Alto</span><div class="fila-3">' +
        inputMedida('altos.0', al[0], 'Izquierda') + inputMedida('altos.1', al[1], 'Centro') + inputMedida('altos.2', al[2], 'Derecha') +
      '</div></div>' +
      '<p class="medida-final" data-medida-final></p>';
  }

  function cortinaHTML(c, i) {
    const titulo = (c.ambiente || '').trim() || 'Cortina ' + (i + 1);
    return (
      '<article class="card cortina" data-cid="' + esc(c.id) + '">' +
        '<div class="card-cabecera">' +
          '<h3><span class="numero">' + (i + 1) + '</span><span data-titulo>' + esc(titulo) + '</span></h3>' +
          '<div class="acciones-card">' +
            '<button type="button" class="btn-icono" data-accion="duplicar" aria-label="Duplicar cortina" title="Duplicar">' + ICONOS.duplicar + '</button>' +
            '<button type="button" class="btn-icono peligro" data-accion="eliminar" aria-label="Eliminar cortina" title="Eliminar">' + ICONOS.borrar + '</button>' +
          '</div>' +
        '</div>' +
        '<label class="campo"><span>Ambiente</span>' +
          '<input type="text" data-campo="ambiente" value="' + esc(c.ambiente) + '" placeholder="Ej: Living, Dormitorio" autocomplete="off"></label>' +
        '<label class="check"><input type="checkbox" data-campo="tresPuntos"' + (c.tresPuntos ? ' checked' : '') + '> Medir en 3 puntos</label>' +
        medidasHTML(c) +
        '<label class="campo solo-cotizar"><span>Tela</span><select data-campo="telaId">' + opcionesTela(c.telaId) + '</select></label>' +
        '<div class="campo"><span>Lado del comando</span>' +
          segmentado('comando-' + c.id, 'comando', c.comando, [{ v: 'izquierda', t: 'Izquierda' }, { v: 'derecha', t: 'Derecha' }]) +
        '</div>' +
        '<div class="campo"><span>Colocación</span>' +
          segmentado('colocacion-' + c.id, 'colocacion', c.colocacion, [{ v: 'dentro', t: 'Dentro del vano' }, { v: 'fuera', t: 'Fuera del vano' }]) +
        '</div>' +
        '<label class="campo"><span>Observaciones <small>(opcional)</small></span>' +
          '<input type="text" data-campo="nota" value="' + esc(c.nota) + '" placeholder="Ej: pared de durlock, enchufe cerca" autocomplete="off"></label>' +
        '<div class="resultado" data-resultado></div>' +
      '</article>'
    );
  }

  function renderCortinas() {
    const cont = $('#lista-cortinas');
    const cortinas = state.pedido.cortinas;
    cont.innerHTML = cortinas.length
      ? cortinas.map(cortinaHTML).join('')
      : '<div class="card vacio">No hay cortinas. Tocá <b>+ Agregar cortina</b>.</div>';
    actualizarResultados();
  }

  /** Redibuja una sola tarjeta (por ejemplo al activar los 3 puntos). */
  function rehacerCortina(cid) {
    const i = state.pedido.cortinas.findIndex((x) => x.id === cid);
    const card = $('[data-cid="' + cid + '"]');
    if (i < 0 || !card) return;
    card.outerHTML = cortinaHTML(state.pedido.cortinas[i], i);
    actualizarResultados();
  }

  function filaCosto(nombre, monto, detalle) {
    return '<tr><td>' + esc(nombre) + (detalle ? '<span class="sub">' + esc(detalle) + '</span>' : '') +
      '</td><td>' + C.fmtPesos(monto) + '</td></tr>';
  }

  function listaMensajes(lista, clase, prefijo) {
    return (lista || []).map((a) => '<div class="mensaje ' + clase + '">' + (prefijo || '') + esc(a) + '</div>').join('');
  }

  /** ¿Se cargó alguna medida (simple o de 3 puntos)? */
  function tieneMedidas(c) {
    const lleno = (v) => !C.vacio(v);
    return c.tresPuntos
      ? (c.anchos || []).some(lleno) || (c.altos || []).some(lleno)
      : lleno(c.ancho) || lleno(c.alto);
  }

  function erroresHTML(c, errores, textoVacio) {
    // Sin medidas todavía: una ayuda en vez de una lista de errores.
    if (!tieneMedidas(c)) return '<p class="resultado-m2">' + textoVacio + '</p>';
    return '<div class="mensaje mensaje-error"><b>Falta completar:</b><ul>' +
      errores.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
  }

  function detalleTela(r) {
    let d = C.fmtNum(r.m2Tela, 2) + ' m² × ' + C.fmtPesos(r.tela.precioM2);
    if (state.config.telaModo === 'corte') d += ' · tela cortada';
    if (state.config.telaModo === 'rollo') d += ' · ancho de rollo';
    if (state.config.desperdicioTela) d += ' · +' + C.fmtNum(state.config.desperdicioTela, 2) + '% desperdicio';
    if (r.rotada) d += ' · girada';
    return d;
  }

  function detalleTubo(r) {
    let d = 'Ø ' + C.fmtNum(r.mecanismo.diametro) + ' mm · ' + C.fmtCm(r.cortes.tubo);
    if (r.tuboInfo.modo === 'barra') {
      d += ' · ' + plural(r.tuboInfo.barras, 'barra', 'barras') +
        (r.tuboInfo.cortinas > 1 ? ' entre ' + r.tuboInfo.cortinas + ' cortinas' : ' entera');
    }
    return d;
  }

  /** HTML del resultado de una cortina en modo cotizar (precio, m², avisos y desglose). */
  function resultadoHTML(c, r) {
    if (!r.ok) return erroresHTML(c, r.errores, 'Cargá el ancho y el alto para ver el precio.');
    const k = r.costos;
    const filas =
      filaCosto('Tela', k.tela, detalleTela(r)) +
      filaCosto('Tubo', k.tubo, detalleTubo(r)) +
      filaCosto('Mecanismo', k.mecanismo, 'soportes + embrague') +
      filaCosto('Contrapeso', k.contrapeso, C.fmtCm(r.cortes.contrapeso)) +
      filaCosto('Cadena', k.cadena, C.fmtCm(r.cortes.cadena)) +
      filaCosto('Mano de obra', k.manoObra) +
      k.adicionales.map((a) => filaCosto(a.nombre, a.monto)).join('') +
      '<tr class="total"><td>Costo total</td><td>' + C.fmtPesos(r.costoTotal) + '</td></tr>' +
      '<tr><td>Margen ' + esc(C.fmtNum(state.config.margen, 2)) + '%</td><td>' + C.fmtPesos(r.precioSinRedondeo - r.costoTotal) + '</td></tr>' +
      (r.precio !== r.precioSinRedondeo
        ? '<tr><td>Redondeo</td><td>' + C.fmtPesos(r.precio - r.precioSinRedondeo) + '</td></tr>'
        : '') +
      '<tr class="total"><td>Precio de venta</td><td>' + C.fmtPesos(r.precio) + '</td></tr>';
    return (
      listaMensajes(r.avisos, 'mensaje-aviso', '⚠️ ') +
      listaMensajes(r.notas, 'mensaje-info', 'ℹ️ ') +
      '<div class="resultado-precio"><span>Precio de venta</span><span class="monto">' + C.fmtPesos(r.precio) + '</span></div>' +
      '<div class="resultado-m2">' + C.fmtM2(r.m2Reales) + ' reales · ' + C.fmtM2(r.m2Fact) + ' facturables</div>' +
      '<details class="desglose"' + (state.desgloseAbierto.has(c.id) ? ' open' : '') + '>' +
        '<summary>Ver costos</summary><table class="tabla-simple">' + filas + '</table>' +
      '</details>'
    );
  }

  /** Resultado en modo medición: solo medidas (sin precios). */
  function resultadoMedicionHTML(c) {
    const m = C.medidasFinales(c);
    if (!m.ok) return erroresHTML(c, m.errores, 'Cargá el ancho y el alto.');
    return '<div class="resultado-precio"><span>Medida final</span><span class="monto">' +
      C.fmtNum(m.ancho) + ' × ' + C.fmtNum(m.alto) + ' cm</span></div>';
  }

  /** Recalcula todo el pedido y actualiza los resultados de cada tarjeta y el total. */
  function actualizarResultados() {
    const res = C.calcularPedido(state.pedido, state.config);
    const medicion = modoActual() === 'medicion';
    res.items.forEach((it) => {
      const c = it.cortina;
      const card = $('[data-cid="' + c.id + '"]', $('#lista-cortinas'));
      if (!card) return;
      $('[data-resultado]', card).innerHTML = medicion ? resultadoMedicionHTML(c) : resultadoHTML(c, it.r);

      // Medida final con 3 puntos.
      const mf = $('[data-medida-final]', card);
      if (mf) {
        const m = C.medidasFinales(c);
        mf.innerHTML = m.ok
          ? 'Medida final: <b>' + C.fmtNum(m.ancho) + ' × ' + C.fmtNum(m.alto) + ' cm</b> · ' + C.txtCriterio(m.criterio)
          : 'Se usa ' + C.txtCriterio(m.criterio) + '.';
      }

      // Marca en rojo las medidas que no son números válidos.
      $$('input[data-campo]', card).forEach((inp) => {
        if (!/^(ancho|alto|anchos\.\d|altos\.\d)$/.test(inp.dataset.campo)) return;
        const txt = inp.value.trim();
        const n = C.num(txt);
        inp.classList.toggle('invalido', txt !== '' && (Number.isNaN(n) || n <= 0));
      });
      $('[data-campo="telaId"]', card).classList.toggle('invalido', !medicion && !it.r.tela && cortinaTieneDatos(c));
    });
    actualizarTotal(res);
  }

  function actualizarTotal(res) {
    if (modoActual() === 'medicion') {
      const listas = state.pedido.cortinas.filter((c) => C.medidasFinales(c).ok).length;
      const faltan = state.pedido.cortinas.length - listas;
      $('#total-label').textContent = 'Medición';
      $('#total-detalle').textContent = plural(listas, 'cortina medida', 'cortinas medidas') + (faltan ? ' · ' + faltan + ' sin completar' : '');
    } else {
      $('#total-label').textContent = 'Total del pedido';
      $('#total-monto').textContent = C.fmtPesos(res.total);
      let detalle = plural(res.completas, 'cortina', 'cortinas');
      if (res.incompletas) detalle += ' · ' + res.incompletas + ' sin completar';
      $('#total-detalle').textContent = detalle;
    }
    renderInfoEdicion(res);
  }

  function renderInfoEdicion(res) {
    const p = state.pedido;
    const info = $('#info-edicion');
    $('#t-pedido').textContent = p.id ? 'Editar pedido' : 'Nuevo pedido';
    if (!p.id) { info.hidden = true; return; }
    const guardado = state.pedidos.find((x) => x.id === p.id);
    let txt = 'Pedido guardado el ' + C.fmtFecha(p.fecha) + ' · ' + esc(p.estado || C.ESTADO_INICIAL);
    if (state.sucio) txt += ' · <b>cambios sin guardar</b>';
    else if (modoActual() === 'cotizar' && guardado && guardado.estado !== C.ESTADO_MEDICION &&
      res && Number.isFinite(guardado.total) && guardado.total !== res.total) {
      txt += '<br>⚠️ Con los precios actuales el total da <b>' + C.fmtPesos(res.total) +
        '</b> (se guardó en ' + C.fmtPesos(guardado.total) + '). Tocá Guardar para actualizarlo.';
    }
    info.innerHTML = txt;
    info.hidden = false;
  }

  function agregarCortina() {
    const nueva = C.nuevaCortina(state.config, { telaId: telaPreferida() });
    state.pedido.cortinas.push(nueva);
    marcarSucio();
    renderCortinas();
    const card = $('[data-cid="' + nueva.id + '"]');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('[data-campo="ambiente"]', card).focus({ preventScroll: true }), 300);
    }
  }

  function duplicarCortina(cid) {
    const lista = state.pedido.cortinas;
    const i = lista.findIndex((c) => c.id === cid);
    if (i < 0) return;
    const copia = Object.assign(C.clonar(lista[i]), { id: C.uid() });
    lista.splice(i + 1, 0, copia);
    marcarSucio();
    renderCortinas();
    const card = $('[data-cid="' + copia.id + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Cortina duplicada');
  }

  function eliminarCortina(cid) {
    const lista = state.pedido.cortinas;
    const i = lista.findIndex((c) => c.id === cid);
    if (i < 0) return;
    const c = lista[i];
    const nombre = (c.ambiente || '').trim() || 'Cortina ' + (i + 1);
    if (cortinaTieneDatos(c) && !confirm('¿Eliminar "' + nombre + '"?')) return;
    lista.splice(i, 1);
    state.desgloseAbierto.delete(cid);
    marcarSucio();
    renderCortinas();
  }

  /** Activa o desactiva los 3 puntos pasando la medida que ya estaba cargada. */
  function cambiarTresPuntos(c, activar) {
    if (activar) {
      if (!(c.anchos || []).some((v) => !C.vacio(v))) c.anchos = [c.ancho || '', '', ''];
      if (!(c.altos || []).some((v) => !C.vacio(v))) c.altos = [c.alto || '', '', ''];
    } else {
      const m = C.medidasFinales(c);
      if (!Number.isNaN(m.ancho)) c.ancho = C.fmtNum(m.ancho);
      if (!Number.isNaN(m.alto)) c.alto = C.fmtNum(m.alto);
    }
    c.tresPuntos = activar;
  }

  function guardarPedido() {
    const p = state.pedido;
    const medicion = modoActual() === 'medicion';
    const res = C.calcularPedido(p, state.config);
    if (!(p.cliente.nombre || '').trim()) {
      toast('Poné el nombre del cliente', 'error');
      const inp = $('[data-cliente="nombre"]');
      inp.focus();
      inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const listas = medicion ? p.cortinas.filter((c) => C.medidasFinales(c).ok).length : res.completas;
    const faltan = p.cortinas.length - listas;
    if (!listas) {
      toast(medicion ? 'Cargá las medidas de al menos una cortina' : 'Cargá al menos una cortina completa', 'error');
      return;
    }
    if (faltan && !confirm(
      'Hay ' + plural(faltan, 'cortina', 'cortinas') + ' sin completar' +
      (medicion ? '' : ' que no suman al total') + '. ¿Guardar igual?'
    )) return;

    const ahora = new Date().toISOString();
    const guardado = C.clonar(p);
    guardado.total = res.total;
    guardado.actualizado = ahora;
    const idx = p.id ? state.pedidos.findIndex((x) => x.id === p.id) : -1;
    if (idx >= 0) {
      // El estado y la seña se manejan desde la pestaña Pedidos.
      const anterior = state.pedidos[idx];
      guardado.estado = anterior.estado;
      guardado.sena = anterior.sena;
      guardado.fecha = anterior.fecha;
      // Una medición que se cotiza pasa a "Presupuestado".
      if (!medicion && guardado.estado === C.ESTADO_MEDICION) guardado.estado = C.ESTADO_INICIAL;
      state.pedidos[idx] = guardado;
    } else {
      guardado.id = C.uid();
      guardado.fecha = ahora;
      guardado.estado = medicion ? C.ESTADO_MEDICION : C.ESTADO_INICIAL;
      guardado.sena = '';
      state.pedidos.unshift(guardado);
    }
    S.guardarPedidos(state.pedidos);
    state.pedido = completarPedido(C.clonar(guardado));
    state.sucio = false;
    guardarBorrador(true);
    actualizarTotal(res);
    toast(medicion ? 'Medición guardada ✓' : 'Pedido guardado ✓');
  }

  function empezarPedidoNuevo() {
    if (!puedeDescartarPedido()) return;
    cargarPedidoEnEditor(C.nuevoPedido(state.config, { telaId: telaPreferida(), modo: modoActual() }));
    window.scrollTo(0, 0);
  }

  function bindPedido() {
    const lista = $('#lista-cortinas');

    function alCambiar(e) {
      const el = e.target;
      const campo = el.dataset.campo;
      if (!campo) return;
      if (el.type === 'radio' && !el.checked) return;
      const card = el.closest('[data-cid]');
      const c = state.pedido.cortinas.find((x) => x.id === card.dataset.cid);
      if (!c) return;

      if (campo === 'tresPuntos') {
        if (e.type !== 'change') return;
        cambiarTresPuntos(c, el.checked);
        marcarSucio();
        rehacerCortina(c.id);
        return;
      }

      const partes = campo.split('.'); // "anchos.1" → c.anchos[1]
      if (partes.length === 2) {
        if (!Array.isArray(c[partes[0]])) c[partes[0]] = ['', '', ''];
        c[partes[0]][Number(partes[1])] = el.value;
      } else {
        c[campo] = el.value;
      }
      if (campo === 'ambiente') {
        const i = state.pedido.cortinas.indexOf(c);
        $('[data-titulo]', card).textContent = el.value.trim() || 'Cortina ' + (i + 1);
      }
      if (campo === 'telaId' && el.value) S.guardarPreferencia('ultimaTela', el.value);
      marcarSucio();
      actualizarResultados();
    }
    lista.addEventListener('input', alCambiar);
    lista.addEventListener('change', alCambiar);

    lista.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-accion]');
      if (!btn) return;
      const cid = btn.closest('[data-cid]').dataset.cid;
      if (btn.dataset.accion === 'duplicar') duplicarCortina(cid);
      if (btn.dataset.accion === 'eliminar') eliminarCortina(cid);
    });

    // Recordar qué desgloses están abiertos ("toggle" no burbujea: se escucha en captura).
    lista.addEventListener('toggle', (e) => {
      if (!e.target.matches('details.desglose')) return;
      const cid = e.target.closest('[data-cid]').dataset.cid;
      if (e.target.open) state.desgloseAbierto.add(cid);
      else state.desgloseAbierto.delete(cid);
    }, true);

    $$('[data-cliente]').forEach((inp) => {
      inp.addEventListener('input', () => {
        state.pedido.cliente[inp.dataset.cliente] = inp.value;
        marcarSucio();
        renderInfoEdicion(C.calcularPedido(state.pedido, state.config));
      });
    });

    $$('[data-modo]').forEach((r) => {
      r.addEventListener('change', () => { if (r.checked) cambiarModo(r.value); });
    });

    $('#btn-agregar-cortina').addEventListener('click', agregarCortina);
    $('#btn-guardar-pedido').addEventListener('click', guardarPedido);
    $('#btn-nuevo-pedido').addEventListener('click', empezarPedidoNuevo);
    $('#btn-pasar-cotizar').addEventListener('click', () => { cambiarModo('cotizar'); window.scrollTo(0, 0); });
    $('#btn-presupuesto').addEventListener('click', abrirPresupuesto);
    $('#btn-hoja-corte').addEventListener('click', abrirHoja);
  }

  /* ==================================================================
     4. Presupuesto para WhatsApp (sin costos ni margen)
     ================================================================== */

  function abrirPresupuesto() {
    const res = C.calcularPedido(state.pedido, state.config);
    if (!res.completas) {
      toast('Cargá al menos una cortina completa', 'error');
      return;
    }
    const texto = C.textoPresupuesto(state.pedido, state.config);
    $('#texto-presupuesto').textContent = texto;
    $('#btn-abrir-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(texto);
    abrirDialogo($('#dlg-presupuesto'));
  }

  function bindDialogos() {
    $$('dialog').forEach((dlg) => {
      dlg.addEventListener('click', (e) => {
        // Cerrar con la X, con "Entendido" o tocando afuera.
        if (e.target.closest('[data-cerrar]') || e.target === dlg) cerrarDialogo(dlg);
      });
    });
    $('#btn-copiar').addEventListener('click', () => {
      copiarTexto($('#texto-presupuesto').textContent)
        .then(() => toast('¡Copiado! Ya lo podés pegar en WhatsApp'))
        .catch(() => toast('No se pudo copiar. Mantené apretado el texto para copiarlo.', 'error'));
    });
  }

  /* ==================================================================
     5. Hoja de corte (para el taller, imprimible)
     ================================================================== */

  function planBarrasHTML(res, cfg) {
    if (!res.planTubos.length) return '';
    const grupos = res.planTubos.map((g) => {
      const barras = g.barras.map((b) =>
        '<li>' + b.cortes.map((c) => esc(c.ambiente) + ' ' + C.fmtNum(c.largo)).join(' + ') +
        ' cm → sobra ' + C.fmtCm(b.sobrante) + '</li>'
      ).join('');
      const largas = g.largas.map((l) =>
        '<li><b>⚠ ' + esc(l.ambiente) + ' ' + C.fmtCm(l.largo) + ': más largo que la barra, pedir especial</b></li>'
      ).join('');
      return '<p><b>Ø ' + C.fmtNum(g.diametro) + ' mm</b> · ' + plural(g.cantidad, 'barra', 'barras') + '</p><ol>' + barras + largas + '</ol>';
    }).join('');
    return '<div class="hoja-plan"><div class="card"><b>Plan de corte de tubos</b> (barras de ' + C.fmtCm(cfg.largoBarra) + ')' + grupos + '</div></div>';
  }

  function hojaHTML() {
    const p = state.pedido;
    const cfg = state.config;
    const res = C.calcularPedido(p, cfg);
    const filas = C.filasHojaCorte(p, cfg, res);
    const mat = C.resumenMateriales(p, cfg, res);
    const cli = p.cliente || {};
    const d = cfg.descuentos;
    const m = (cm) => C.fmtNum(cm / 100, 2) + ' m';

    const cuerpo = filas.map((f, i) => {
      const nota = f.nota ? '<span class="nota">📝 ' + esc(f.nota) + '</span>' : '';
      if (!f.ok) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(f.ambiente) + nota + '</td>' +
          '<td colspan="7"><span class="alerta">Incompleta: ' + esc(f.errores.join(', ')) + '</span></td></tr>';
      }
      const alertas = f.avisos.map((a) => '<span class="alerta">⚠ ' + esc(a) + '</span>').join('');
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><b>' + esc(f.ambiente) + '</b><span class="sub">' + esc(f.colocacion) + '</span>' + nota + '</td>' +
        '<td class="num">' + C.fmtNum(f.ancho) + ' × ' + C.fmtNum(f.alto) +
          (f.tresPuntos ? '<span class="sub">3 puntos: ' + (f.criterio === 'max' ? 'la mayor' : 'la menor') + '</span>' : '') + '</td>' +
        '<td>' + esc(f.tela) + alertas + '</td>' +
        '<td class="num">' + C.fmtNum(f.telaAncho) + ' × ' + C.fmtNum(f.telaLargo) +
          (f.rotada ? '<br><span class="girada">GIRADA</span>' : '') + '</td>' +
        '<td class="num">Ø ' + C.fmtNum(f.tuboDiametro) + ' mm<span class="sub">' + C.fmtCm(f.tuboLargo) + '</span></td>' +
        '<td class="num">' + C.fmtCm(f.contrapeso) + '</td>' +
        '<td class="num">' + C.fmtCm(f.cadena) + '</td>' +
        '<td><b>' + (f.comando === 'izquierda' ? 'Izquierda' : 'Derecha') + '</b></td>' +
      '</tr>';
    }).join('');

    return (
      '<div class="hoja-titulo"><h2>Hoja de corte</h2><div>' +
        esc(cfg.negocio.nombre) + ' · ' + C.fmtFecha(new Date().toISOString()) + '</div></div>' +
      '<div class="hoja-datos">' +
        '<div><b>Cliente:</b> ' + esc(cli.nombre || '—') + '</div>' +
        '<div><b>Teléfono:</b> ' + esc(cli.telefono || '—') + '</div>' +
        '<div><b>Dirección:</b> ' + esc(cli.direccion || '—') + '</div>' +
        '<div><b>Estado:</b> ' + esc(p.id ? p.estado : 'Sin guardar') + '</div>' +
      '</div>' +
      '<div class="tabla-scroll"><table class="tabla-corte">' +
        '<thead><tr>' +
          '<th>#</th><th>Ambiente</th><th>Medida final<span class="sub">ancho × alto (cm)</span></th>' +
          '<th>Tela</th><th>Corte de tela<span class="sub">ancho × largo (cm)</span></th>' +
          '<th>Tubo</th><th>Contrapeso</th><th>Cadena</th><th>Comando</th>' +
        '</tr></thead><tbody>' + cuerpo + '</tbody></table></div>' +
      planBarrasHTML(res, cfg) +
      '<div class="hoja-resumen">' +
        '<div class="card"><b>Rollo a usar (largo total)</b><ul>' +
          (mat.telas.map((t) => '<li>' + esc(t.nombre) + ': ' + m(t.largo) + '</li>').join('') || '<li>—</li>') + '</ul></div>' +
        '<div class="card"><b>Tubos</b><ul>' +
          (mat.tubos.map((t) => '<li>Ø ' + C.fmtNum(t.diametro) + ' mm: ' + m(t.largo) + ' (' + plural(t.barras, 'barra', 'barras') +
            (t.especiales ? ' + ' + t.especiales + ' especial' : '') + ')</li>').join('') || '<li>—</li>') + '</ul></div>' +
        '<div class="card"><b>Contrapeso y cadena</b><ul>' +
          '<li>Contrapeso: ' + m(mat.contrapeso) + '</li><li>Cadena: ' + m(mat.cadena) + '</li></ul></div>' +
        '<div class="card"><b>Descuentos usados</b><ul>' +
          '<li>Tela: ancho − ' + C.fmtNum(d.telaAncho) + ' cm · alto + ' + C.fmtNum(cfg.agregadoAlto) + ' cm</li>' +
          '<li>Tubo: ancho − ' + C.fmtNum(d.tuboLargo) + ' cm</li>' +
          '<li>Contrapeso: ancho − ' + C.fmtNum(d.contrapesoLargo) + ' cm</li>' +
          '<li>Cadena: alto × ' + C.fmtNum(cfg.cadenaFactor, 2) + '</li></ul></div>' +
      '</div>'
    );
  }

  function abrirHoja() {
    const res = C.calcularPedido(state.pedido, state.config);
    if (!res.completas) {
      toast('Cargá al menos una cortina completa', 'error');
      return;
    }
    $('#hoja-contenido').innerHTML = hojaHTML();
    $('#hoja-corte').hidden = false;
    document.body.style.overflow = 'hidden';
    // Para que el botón "atrás" del celular cierre la hoja en vez de salir.
    history.pushState({ hoja: true }, '');
  }

  function cerrarHoja() {
    $('#hoja-corte').hidden = true;
    document.body.style.overflow = '';
  }

  function bindHoja() {
    $('#btn-cerrar-hoja').addEventListener('click', () => {
      if (history.state && history.state.hoja) history.back();
      else cerrarHoja();
    });
    $('#btn-imprimir').addEventListener('click', () => window.print());
    window.addEventListener('popstate', () => {
      if (!$('#hoja-corte').hidden) cerrarHoja();
    });
  }

  /* ==================================================================
     6. Pedidos guardados
     ================================================================== */

  function guardarPedidos() {
    S.guardarPedidos(state.pedidos);
  }

  function renderFiltros() {
    const opciones = [{ v: '', t: 'Todos', n: state.pedidos.length }].concat(
      C.ESTADOS.map((e) => ({ v: e, t: e, n: state.pedidos.filter((p) => p.estado === e).length }))
    );
    $('#filtro-estados').innerHTML = opciones.map((o) =>
      '<button type="button" class="chip" data-estado="' + esc(o.v) + '" aria-pressed="' + (state.filtroEstado === o.v) + '">' +
      esc(o.t) + ' (' + o.n + ')</button>'
    ).join('');
  }

  function saldoDe(p) {
    return (Number(p.total) || 0) - C.numOr(p.sena, 0);
  }

  function pedidoCardHTML(p) {
    const estado = p.estado || C.ESTADO_INICIAL;
    const idxEstado = Math.max(0, C.ESTADOS.indexOf(estado));
    const n = (p.cortinas || []).length;
    const cli = p.cliente || {};
    const meta = [C.fmtFecha(p.fecha), plural(n, 'cortina', 'cortinas'), cli.telefono].filter(Boolean).map(esc).join(' · ');
    const sinCotizar = estado === C.ESTADO_MEDICION;
    return (
      '<article class="card" data-pid="' + esc(p.id) + '">' +
        '<div class="pedido-cabecera"><div>' +
          '<div class="pedido-cliente">' + esc(cli.nombre || 'Sin nombre') + '</div>' +
          '<div class="pedido-meta">' + meta + '</div>' +
          '<span class="estado estado-' + idxEstado + '">' + esc(estado) + '</span>' +
        '</div><div class="pedido-total">' + (sinCotizar ? 'Sin cotizar' : C.fmtPesos(Number(p.total) || 0)) + '</div></div>' +
        '<div class="fila">' +
          '<label class="campo"><span>Estado</span><select data-pcampo="estado">' +
            C.ESTADOS.map((e) => '<option' + (e === estado ? ' selected' : '') + '>' + esc(e) + '</option>').join('') +
          '</select></label>' +
          '<label class="campo"><span>Seña</span><div class="con-prefijo">' +
            '<input type="text" inputmode="decimal" data-pcampo="sena" value="' + esc(p.sena) + '" placeholder="0" autocomplete="off"></div></label>' +
        '</div>' +
        (sinCotizar ? '' : '<div class="pedido-saldo">Saldo: <b data-saldo>' + C.fmtPesos(saldoDe(p)) + '</b></div>') +
        '<div class="pedido-acciones">' +
          '<button type="button" class="btn btn-secundario" data-paccion="abrir">' + (sinCotizar ? 'Abrir / cotizar' : 'Abrir / editar') + '</button>' +
          '<button type="button" class="btn btn-peligro" data-paccion="borrar">Borrar</button>' +
        '</div>' +
      '</article>'
    );
  }

  function renderPedidos() {
    renderFiltros();
    const q = normalizarTexto(state.busqueda.trim());
    const lista = state.pedidos
      .filter((p) => !state.filtroEstado || p.estado === state.filtroEstado)
      .filter((p) => !q || normalizarTexto((p.cliente && p.cliente.nombre) + ' ' + (p.cliente && p.cliente.telefono)).includes(q))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const cont = $('#lista-pedidos');
    if (!state.pedidos.length) {
      cont.innerHTML = '<div class="vacio">Todavía no hay pedidos guardados.<br>Cargá uno en <b>Nuevo pedido</b> y tocá <b>Guardar</b>.</div>';
    } else if (!lista.length) {
      cont.innerHTML = '<div class="vacio">No hay pedidos con ese filtro.</div>';
    } else {
      cont.innerHTML = lista.map(pedidoCardHTML).join('');
    }
  }

  function bindPedidos() {
    $('#filtro-estados').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-estado]');
      if (!chip) return;
      state.filtroEstado = chip.dataset.estado;
      renderPedidos();
    });
    $('#buscar-pedido').addEventListener('input', (e) => {
      state.busqueda = e.target.value;
      renderPedidos();
    });

    const cont = $('#lista-pedidos');
    cont.addEventListener('change', (e) => {
      if (e.target.dataset.pcampo !== 'estado') return;
      const p = state.pedidos.find((x) => x.id === e.target.closest('[data-pid]').dataset.pid);
      if (!p) return;
      p.estado = e.target.value;
      guardarPedidos();
      if (state.pedido.id === p.id) { state.pedido.estado = p.estado; guardarBorrador(); }
      renderPedidos();
      toast('Estado: ' + p.estado);
    });
    cont.addEventListener('input', (e) => {
      if (e.target.dataset.pcampo !== 'sena') return;
      const card = e.target.closest('[data-pid]');
      const p = state.pedidos.find((x) => x.id === card.dataset.pid);
      if (!p) return;
      const txt = e.target.value.trim();
      const n = C.num(txt);
      const invalido = txt !== '' && (Number.isNaN(n) || n < 0);
      e.target.classList.toggle('invalido', invalido);
      if (invalido) return;
      p.sena = txt;
      guardarPedidos();
      const saldo = $('[data-saldo]', card);
      if (saldo) saldo.textContent = C.fmtPesos(saldoDe(p));
    });
    cont.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-paccion]');
      if (!btn) return;
      const idx = state.pedidos.findIndex((x) => x.id === btn.closest('[data-pid]').dataset.pid);
      if (idx < 0) return;
      const p = state.pedidos[idx];
      if (btn.dataset.paccion === 'abrir') {
        // Si ya se está editando este mismo pedido, se vuelve sin pisar los cambios.
        if (state.pedido.id !== p.id) {
          if (!puedeDescartarPedido()) return;
          cargarPedidoEnEditor(C.clonar(p));
        }
        location.hash = '#pedido';
      }
      if (btn.dataset.paccion === 'borrar') {
        const nombre = (p.cliente && p.cliente.nombre) || 'sin nombre';
        if (!confirm('¿Borrar el pedido de ' + nombre + '? No se puede deshacer.')) return;
        state.pedidos.splice(idx, 1);
        guardarPedidos();
        // Si justo se estaba editando, queda como pedido nuevo sin guardar.
        if (state.pedido.id === p.id) {
          state.pedido.id = null;
          state.sucio = true;
          guardarBorrador(true);
          actualizarResultados();
        }
        renderPedidos();
        toast('Pedido borrado');
      }
    });
  }

  /* ==================================================================
     7. Configuración
     ================================================================== */

  // Grupos de la herramienta "Aumento de precios".
  const GRUPOS_AUMENTO = [
    { k: 'telas', t: 'Telas (costo por m²)' },
    { k: 'tubos', t: 'Mecanismos y tubos' },
    { k: 'insumos', t: 'Contrapeso y cadena' },
    { k: 'manoObra', t: 'Mano de obra' },
    { k: 'adicionales', t: 'Costos adicionales' }
  ];

  /** Valor para mostrar en un input: números con formato argentino, texto tal cual. */
  function valorInput(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? C.fmtNum(v, 4) : '';
    return v === null || v === undefined ? '' : String(v);
  }

  function leerRuta(obj, ruta) {
    return ruta.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
  }

  function escribirRuta(obj, ruta, valor) {
    const partes = ruta.split('.');
    let o = obj;
    for (let i = 0; i < partes.length - 1; i++) {
      if (o[partes[i]] === null || typeof o[partes[i]] !== 'object') o[partes[i]] = {};
      o = o[partes[i]];
    }
    o[partes[partes.length - 1]] = valor;
  }

  function ayudaHTML(texto) {
    return texto ? '<small class="campo-ayuda">' + texto + '</small>' : '';
  }

  /**
   * Campo de configuración. op: { tipo: 'num'|'texto'|'tel', unidad, prefijo, ayuda, placeholder }
   */
  function campoCfg(ruta, etiqueta, op) {
    const o = op || {};
    const valor = esc(valorInput(leerRuta(state.cfgDraft, ruta)));
    const tipo = o.tipo === 'tel' ? 'tel' : 'text';
    const modo = o.tipo === 'num' || !o.tipo ? ' inputmode="decimal"' : '';
    let input = '<input type="' + tipo + '"' + modo + ' data-ruta="' + ruta + '" value="' + valor + '"' +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + ' autocomplete="off">';
    if (o.unidad) input = '<div class="con-unidad" data-unidad="' + esc(o.unidad) + '">' + input + '</div>';
    else if (o.prefijo) input = '<div class="con-prefijo">' + input + '</div>';
    return '<label class="campo"><span>' + etiqueta + '</span>' + input + ayudaHTML(o.ayuda) + '</label>';
  }

  /** Desplegable de configuración. opciones: { valor: texto } */
  function selectCfg(ruta, etiqueta, opciones, ayuda) {
    const actual = String(valorInput(leerRuta(state.cfgDraft, ruta)));
    return '<label class="campo"><span>' + etiqueta + '</span><select data-ruta="' + ruta + '">' +
      Object.keys(opciones).map((v) =>
        '<option value="' + esc(v) + '"' + (String(v) === actual || (actual === '' && v === '0') ? ' selected' : '') + '>' + esc(opciones[v]) + '</option>'
      ).join('') + '</select>' + ayudaHTML(ayuda) + '</label>';
  }

  function checkCfg(ruta, texto) {
    return '<label class="check"><input type="checkbox" data-ruta="' + ruta + '"' +
      (leerRuta(state.cfgDraft, ruta) ? ' checked' : '') + '> ' + texto + '</label>';
  }

  function seccion(titulo, cuerpo, ayuda) {
    return '<div class="card"><h3 class="card-titulo">' + titulo + '</h3>' +
      (ayuda ? '<p class="ayuda">' + ayuda + '</p>' : '') + cuerpo + '</div>';
  }

  function cabeceraItem(titulo, accion, i) {
    return '<div class="item-lista-cabecera"><span>' + titulo + '</span>' +
      '<button type="button" class="btn-icono peligro" data-caccion="' + accion + '" data-i="' + i + '" aria-label="Borrar">' +
      ICONOS.borrar + '</button></div>';
  }

  function renderConfig() {
    const d = state.cfgDraft;

    const telas =
      '<div class="fila">' +
        selectCfg('telaModo', 'Cómo se cobra la tela', C.MODOS_TELA) +
        campoCfg('desperdicioTela', 'Desperdicio extra', { unidad: '%', ayuda: 'Se suma a los m² de tela' }) +
      '</div>' +
      d.telas.map((t, i) =>
        '<div class="item-lista">' + cabeceraItem('Tela ' + (i + 1), 'borrar-tela', i) +
          campoCfg('telas.' + i + '.nombre', 'Nombre', { tipo: 'texto', placeholder: 'Ej: Blackout' }) +
          '<div class="fila">' +
            campoCfg('telas.' + i + '.precioM2', 'Costo por m²', { prefijo: true }) +
            campoCfg('telas.' + i + '.anchoRollo', 'Ancho de rollo', { unidad: 'cm' }) +
          '</div>' +
          checkCfg('telas.' + i + '.rotable', 'Se puede cortar girada') +
        '</div>'
      ).join('') +
      '<button type="button" class="btn btn-secundario btn-bloque" data-caccion="agregar-tela">+ Agregar tela</button>';

    const mecanismos =
      '<div class="fila">' +
        selectCfg('tuboModo', 'Cómo se cobra el tubo', C.MODOS_TUBO) +
        campoCfg('largoBarra', 'Largo de barra', { unidad: 'cm', ayuda: 'También arma el plan de corte' }) +
      '</div>' +
      d.mecanismos.map((m, i) => {
        const hasta = C.num(m.hastaAncho);
        const titulo = Number.isNaN(hasta) ? 'Rango ' + (i + 1) + ': sin límite' : 'Rango ' + (i + 1) + ': hasta ' + C.fmtCm(hasta);
        return '<div class="item-lista">' + cabeceraItem(titulo, 'borrar-mec', i) +
          '<div class="fila">' +
            campoCfg('mecanismos.' + i + '.hastaAncho', 'Hasta ancho', { unidad: 'cm', placeholder: 'sin límite' }) +
            campoCfg('mecanismos.' + i + '.diametro', 'Tubo Ø', { unidad: 'mm' }) +
          '</div><div class="fila">' +
            campoCfg('mecanismos.' + i + '.costoMecanismo', 'Mecanismo', { prefijo: true, ayuda: 'soportes + embrague' }) +
            campoCfg('mecanismos.' + i + '.costoTuboMetro', 'Tubo por metro', { prefijo: true }) +
          '</div></div>';
      }).join('') +
      '<button type="button" class="btn btn-secundario btn-bloque" data-caccion="agregar-mec">+ Agregar rango</button>';

    const adicionales = d.adicionales.map((a, i) =>
      '<div class="item-lista">' + cabeceraItem('Adicional ' + (i + 1), 'borrar-adic', i) +
        checkCfg('adicionales.' + i + '.activo', 'Se suma al costo') +
        campoCfg('adicionales.' + i + '.nombre', 'Nombre', { tipo: 'texto', placeholder: 'Ej: Instalación, Flete' }) +
        '<div class="fila">' +
          selectCfg('adicionales.' + i + '.tipo', 'Cómo se cobra', C.TIPOS_ADICIONAL) +
          campoCfg('adicionales.' + i + '.valor', 'Valor', { prefijo: true }) +
        '</div></div>'
    ).join('') +
      '<button type="button" class="btn btn-secundario btn-bloque" data-caccion="agregar-adic">+ Agregar costo</button>';

    const redondeos = {};
    C.REDONDEOS.forEach((v) => { redondeos[v] = v ? 'Hacia arriba a ' + C.fmtPesos(v) : 'Sin redondear'; });

    const aumento =
      '<label class="campo"><span>Porcentaje</span><div class="con-unidad" data-unidad="%">' +
        '<input type="text" data-aumento="pct" value="' + esc(state.aumento.pct) + '" placeholder="Ej: 8" autocomplete="off"></div>' +
        ayudaHTML('Para bajar precios poné un número negativo, ej: -5') + '</label>' +
      GRUPOS_AUMENTO.map((g) =>
        '<label class="check"><input type="checkbox" data-aumento-grupo="' + g.k + '"' + (state.aumento.grupos[g.k] ? ' checked' : '') + '> ' + g.t + '</label>'
      ).join('') +
      '<button type="button" class="btn btn-secundario btn-bloque" data-caccion="aumentar">Aplicar aumento</button>';

    const telaEj = d.telas.some((t) => t.id === state.ejemplo.telaId) ? state.ejemplo.telaId : (d.telas[0] && d.telas[0].id) || '';
    state.ejemplo.telaId = telaEj;

    $('#form-config').innerHTML =
      seccion('Telas', telas,
        'Costo por m² y ancho del rollo. Si una cortina es más ancha que el rollo, la app avisa; si la tela se puede girar, la corta girada.') +
      seccion('Mecanismos y tubos', mecanismos,
        'Según el ancho de la cortina se usa el primer rango que alcance. Dejá “Hasta ancho” vacío para el rango más grande (sin límite). ' +
        'Por barra entera: se calculan las barras de todo el pedido y su costo se reparte entre las cortinas.') +
      seccion('Contrapeso y cadena',
        campoCfg('contrapesoMetro', 'Contrapeso: costo por metro', { prefijo: true, ayuda: 'Se multiplica por el largo de corte del contrapeso.' }) +
        campoCfg('cadenaMetro', 'Cadena: costo por metro', { prefijo: true }) +
        campoCfg('cadenaFactor', 'Factor de largo de cadena', { ayuda: 'Largo de cadena = alto × factor. Ej: 0,7' })
      ) +
      seccion('Descuentos de fabricación',
        '<div class="fila">' +
          campoCfg('descuentos.telaAncho', 'Ancho de tela', { unidad: 'cm', ayuda: 'Se resta al ancho' }) +
          campoCfg('descuentos.tuboLargo', 'Largo de tubo', { unidad: 'cm', ayuda: 'Se resta al ancho' }) +
        '</div><div class="fila">' +
          campoCfg('descuentos.contrapesoLargo', 'Largo de contrapeso', { unidad: 'cm', ayuda: 'Se resta al ancho' }) +
          campoCfg('agregadoAlto', 'Agregado de tela en alto', { unidad: 'cm', ayuda: 'Se suma al alto (enrollar + bolsillo)' }) +
        '</div>',
        'Medidas que se descuentan o agregan para la hoja de corte.'
      ) +
      seccion('Mano de obra y ganancia',
        campoCfg('manoObra', 'Mano de obra por cortina', { prefijo: true, ayuda: 'Monto fijo por cada cortina.' }) +
        '<div class="fila">' +
          campoCfg('margen', 'Margen de ganancia', { unidad: '%', ayuda: 'Recargo sobre el costo' }) +
          campoCfg('minimoM2', 'Mínimo facturable', { unidad: 'm²', ayuda: 'Por cortina' }) +
        '</div>' +
        selectCfg('redondeo', 'Redondear precio de venta', redondeos, 'Cada cortina se redondea hacia arriba para que el precio quede prolijo.')
      ) +
      seccion('Costos adicionales', adicionales,
        'Para sumar otros costos sin tocar el código: instalación, flete, accesorios… Elegí si es fijo, por m² o por metro.') +
      seccion('Medición',
        checkCfg('tresPuntos', 'Cortinas nuevas con medición en 3 puntos'),
        'Con 3 puntos se mide el ancho arriba, al medio y abajo, y el alto a la izquierda, al centro y a la derecha. ' +
        'Dentro del vano se usa la medida más chica; fuera del vano, la más grande.'
      ) +
      seccion('Datos del negocio',
        campoCfg('negocio.nombre', 'Nombre del negocio', { tipo: 'texto' }) +
        campoCfg('negocio.telefono', 'Teléfono', { tipo: 'tel' }) +
        campoCfg('negocio.validezDias', 'Validez del presupuesto', { unidad: 'días' }),
        'Aparecen en el presupuesto que se manda al cliente.'
      ) +
      seccion('Aumento de precios', aumento,
        'Sube (o baja) de una vez todos los costos de los grupos tildados. Después revisá los valores y tocá Guardar cambios.') +
      seccion('Cómo se calcula',
        '<div class="fila-3">' +
          '<label class="campo"><span>Ancho</span><div class="con-unidad" data-unidad="cm"><input type="text" inputmode="decimal" data-ejemplo="ancho" value="' + esc(state.ejemplo.ancho) + '"></div></label>' +
          '<label class="campo"><span>Alto</span><div class="con-unidad" data-unidad="cm"><input type="text" inputmode="decimal" data-ejemplo="alto" value="' + esc(state.ejemplo.alto) + '"></div></label>' +
          '<label class="campo"><span>Tela</span><select data-ejemplo="telaId" id="ejemplo-tela"></select></label>' +
        '</div><div id="explicacion"></div>',
        'Cortina de prueba con los valores de esta pantalla (aunque todavía no los hayas guardado). Cambiá un precio y mirá cómo cambia el resultado.'
      ) +
      seccion('Backup',
        '<div class="botones-fila">' +
          '<button type="button" class="btn btn-secundario" data-caccion="exportar">Exportar backup</button>' +
          '<button type="button" class="btn btn-secundario" data-caccion="importar">Importar backup</button>' +
        '</div>',
        'Descargá un archivo con la configuración y todos los pedidos. Guardalo en Drive o mandátelo por mail. Importarlo reemplaza lo que hay en este teléfono.'
      ) +
      seccion('Instalar la app', '<div id="cfg-instalar"></div>') +
      seccion('Valores de ejemplo',
        '<button type="button" class="btn btn-peligro btn-bloque" data-caccion="restaurar">Restaurar valores de ejemplo</button>',
        'Vuelve todos los precios y medidas de esta pantalla a los valores iniciales (los pedidos no se tocan).'
      ) +
      '<p class="ayuda" id="version-app"></p>';

    actualizarSelectEjemplo();
    actualizarExplicacion();
    renderInstalarCfg();
    pedirVersionSW();
    $('#barra-guardar-config').hidden = !state.cfgSucia;
  }

  function actualizarSelectEjemplo() {
    const sel = $('#ejemplo-tela');
    if (!sel) return;
    sel.innerHTML = state.cfgDraft.telas.map((t, i) =>
      '<option value="' + esc(t.id) + '"' + (t.id === state.ejemplo.telaId ? ' selected' : '') + '>' +
      esc(String(t.nombre || '').trim() || 'Tela ' + (i + 1)) + '</option>'
    ).join('');
  }

  function actualizarExplicacion() {
    const cont = $('#explicacion');
    if (!cont) return;
    const { cfg, errores } = C.normalizarConfig(state.cfgDraft);
    const ex = C.explicarCortina(state.ejemplo, cfg);
    let html = '';
    if (errores.length) {
      html += '<div class="mensaje mensaje-aviso">Hay valores incompletos o inválidos; en el ejemplo cuentan como 0.</div>';
    }
    if (!ex.ok) {
      html += '<div class="mensaje mensaje-error">' + esc(ex.errores.join(' · ')) + '</div>';
    } else {
      html += listaMensajes(ex.avisos, 'mensaje-aviso', '⚠️ ') + listaMensajes(ex.notas, 'mensaje-info', 'ℹ️ ');
      html += '<table class="tabla-formulas">' + ex.pasos.map((p) =>
        '<tr' + (p.concepto === 'Costo total' || p.concepto === 'Precio de venta' ? ' class="destacada"' : '') + '>' +
        '<td>' + esc(p.concepto) + '<span class="formula">' + esc(p.formula) + '</span></td>' +
        '<td>' + esc(p.resultado) + '</td></tr>'
      ).join('') + '</table>';
    }
    cont.innerHTML = html;
  }

  function marcarCfgSucia() {
    state.cfgSucia = true;
    $('#barra-guardar-config').hidden = false;
  }

  function guardarConfig() {
    const { cfg, errores } = C.normalizarConfig(state.cfgDraft);
    $$('#form-config .invalido').forEach((el) => el.classList.remove('invalido'));
    if (errores.length) {
      let primero = null;
      errores.forEach((e) => {
        const el = $('#form-config [data-ruta="' + e.ruta + '"]');
        if (el) {
          el.classList.add('invalido');
          if (!primero) primero = el;
        }
      });
      toast(errores[0].msg + (errores.length > 1 ? ' (y ' + (errores.length - 1) + ' más)' : ''), 'error');
      if (primero) primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Ordena los rangos de menor a mayor para que se lean más fácil.
    cfg.mecanismos.sort((a, b) =>
      (a.hastaAncho === null ? Infinity : a.hastaAncho) - (b.hastaAncho === null ? Infinity : b.hastaAncho));
    state.config = cfg;
    S.guardarConfig(cfg);
    state.cfgDraft = C.clonar(cfg);
    state.cfgSucia = false;
    renderConfig();
    renderCortinas(); // las telas del desplegable y los precios pueden haber cambiado
    toast('Configuración guardada ✓');
  }

  function descartarConfig() {
    if (!confirm('¿Descartar los cambios sin guardar?')) return;
    state.cfgDraft = C.clonar(state.config);
    state.cfgSucia = false;
    renderConfig();
  }

  /** Aplica el % de aumento a los costos de los grupos tildados (en el borrador). */
  function aplicarAumento() {
    const pct = C.num(state.aumento.pct);
    if (Number.isNaN(pct) || pct === 0) {
      toast('Poné el porcentaje de aumento', 'error');
      return;
    }
    const factor = 1 + pct / 100;
    if (factor <= 0) {
      toast('El porcentaje no puede ser -100 % o menos', 'error');
      return;
    }
    const g = state.aumento.grupos;
    const elegidos = GRUPOS_AUMENTO.filter((x) => g[x.k]);
    if (!elegidos.length) {
      toast('Tildá al menos un grupo', 'error');
      return;
    }
    const verbo = pct > 0 ? 'Aumentar' : 'Bajar';
    if (!confirm(verbo + ' un ' + C.fmtNum(Math.abs(pct), 2) + ' %: ' + elegidos.map((x) => x.t).join(', ') + '?')) return;

    const d = state.cfgDraft;
    const ajustar = (obj, k) => {
      const n = C.num(obj[k]);
      if (!Number.isNaN(n)) obj[k] = Math.round(n * factor);
    };
    if (g.telas) d.telas.forEach((t) => ajustar(t, 'precioM2'));
    if (g.tubos) d.mecanismos.forEach((m) => { ajustar(m, 'costoMecanismo'); ajustar(m, 'costoTuboMetro'); });
    if (g.insumos) { ajustar(d, 'contrapesoMetro'); ajustar(d, 'cadenaMetro'); }
    if (g.manoObra) ajustar(d, 'manoObra');
    if (g.adicionales) d.adicionales.forEach((a) => ajustar(a, 'valor'));
    state.aumento.pct = '';
    marcarCfgSucia();
    renderConfig();
    toast('Listo: revisá los valores y tocá Guardar cambios');
  }

  function importarBackup(archivo) {
    const lector = new FileReader();
    lector.onload = () => {
      const b = S.validarBackup(String(lector.result || ''));
      if (!b.ok) { toast(b.msg, 'error'); return; }
      const partes = [];
      if (b.config) partes.push('la configuración');
      if (b.pedidos) partes.push('los pedidos (el archivo trae ' + b.pedidos.length + ')');
      if (!confirm('Se van a reemplazar ' + partes.join(' y ') + ' de este teléfono por los del archivo. ¿Seguir?')) return;
      S.aplicarBackup(b);
      state.config = S.cargarConfig();
      state.pedidos = S.cargarPedidos();
      state.cfgDraft = C.clonar(state.config);
      state.cfgSucia = false;
      renderConfig();
      renderCortinas();
      toast('Backup importado ✓');
    };
    lector.onerror = () => toast('No se pudo leer el archivo', 'error');
    lector.readAsText(archivo);
  }

  function bindConfig() {
    const form = $('#form-config');

    function alCambiar(e) {
      const el = e.target;
      if (el.dataset.ejemplo) {
        state.ejemplo[el.dataset.ejemplo] = el.value;
        actualizarExplicacion();
        return;
      }
      if (el.dataset.aumento) {
        state.aumento.pct = el.value;
        return;
      }
      if (el.dataset.aumentoGrupo) {
        state.aumento.grupos[el.dataset.aumentoGrupo] = el.checked;
        return;
      }
      const ruta = el.dataset.ruta;
      if (!ruta) return;
      escribirRuta(state.cfgDraft, ruta, el.type === 'checkbox' ? el.checked : el.value);
      el.classList.remove('invalido');
      marcarCfgSucia();
      if (/^telas\.\d+\.nombre$/.test(ruta)) actualizarSelectEjemplo();
      actualizarExplicacion();
    }
    form.addEventListener('input', alCambiar);
    form.addEventListener('change', alCambiar);

    form.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-caccion]');
      if (!btn) return;
      const d = state.cfgDraft;
      const i = Number(btn.dataset.i);
      switch (btn.dataset.caccion) {
        case 'agregar-tela':
          d.telas.push({ id: C.uid(), nombre: '', precioM2: '', anchoRollo: '', rotable: false });
          break;
        case 'borrar-tela': {
          const nombre = String(d.telas[i].nombre || '').trim() || 'Tela ' + (i + 1);
          if (!confirm('¿Borrar la tela "' + nombre + '"?')) return;
          d.telas.splice(i, 1);
          break;
        }
        case 'agregar-mec':
          d.mecanismos.push({ id: C.uid(), hastaAncho: '', diametro: '', costoMecanismo: '', costoTuboMetro: '' });
          break;
        case 'borrar-mec':
          if (!confirm('¿Borrar el rango ' + (i + 1) + '?')) return;
          d.mecanismos.splice(i, 1);
          break;
        case 'agregar-adic':
          d.adicionales.push({ id: C.uid(), nombre: '', tipo: 'fijo', valor: '', activo: true });
          break;
        case 'borrar-adic':
          if (!confirm('¿Borrar este costo adicional?')) return;
          d.adicionales.splice(i, 1);
          break;
        case 'aumentar':
          aplicarAumento();
          return;
        case 'exportar':
          S.exportarTodo();
          toast('Backup descargado');
          return;
        case 'importar':
          $('#input-importar').click();
          return;
        case 'restaurar':
          if (!confirm('¿Volver todos los precios y medidas a los valores de ejemplo? Después tenés que tocar Guardar cambios.')) return;
          state.cfgDraft = C.clonar(C.DEFAULT_CONFIG);
          break;
        case 'instalar':
          instalar();
          return;
        default:
          return;
      }
      marcarCfgSucia();
      renderConfig();
    });

    $('#btn-guardar-config').addEventListener('click', guardarConfig);
    $('#btn-descartar-config').addEventListener('click', descartarConfig);
    $('#input-importar').addEventListener('change', (e) => {
      const archivo = e.target.files && e.target.files[0];
      if (archivo) importarBackup(archivo);
      e.target.value = '';
    });
  }

  /* ==================================================================
     8. Instalación (PWA)
     ================================================================== */

  let eventoInstalar = null;
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function enStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function actualizarBotonInstalar() {
    $('#btn-instalar').hidden = enStandalone() || !(eventoInstalar || esIOS);
    renderInstalarCfg();
  }

  function renderInstalarCfg() {
    const cont = $('#cfg-instalar');
    if (!cont) return;
    if (enStandalone()) {
      cont.innerHTML = '<p class="ayuda">La app ya está instalada ✓</p>';
    } else if (eventoInstalar) {
      cont.innerHTML = '<p class="ayuda">Instalala para abrirla desde la pantalla de inicio y usarla sin internet.</p>' +
        '<button type="button" class="btn btn-primario btn-bloque" data-caccion="instalar">Instalar</button>';
    } else if (esIOS) {
      cont.innerHTML = '<p class="ayuda">En iPhone: abrí la página en Safari, tocá <b>Compartir → Agregar a inicio</b>.</p>';
    } else {
      cont.innerHTML = '<p class="ayuda">Abrí el menú del navegador (⋮) y elegí <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.</p>';
    }
  }

  function instalar() {
    if (eventoInstalar) {
      eventoInstalar.prompt();
      eventoInstalar.userChoice.finally(() => {
        eventoInstalar = null;
        actualizarBotonInstalar();
      });
    } else if (esIOS) {
      abrirDialogo($('#dlg-ios'));
    }
  }

  function bindInstalar() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // lo guardamos para mostrarlo con nuestro botón
      eventoInstalar = e;
      actualizarBotonInstalar();
    });
    window.addEventListener('appinstalled', () => {
      eventoInstalar = null;
      actualizarBotonInstalar();
      toast('¡App instalada!');
    });
    $('#btn-instalar').addEventListener('click', instalar);
    actualizarBotonInstalar();
  }

  /* ==================================================================
     9. Service worker y aviso de actualización
     ================================================================== */

  let recargarAlCambiar = false;

  function mostrarAvisoUpdate(worker) {
    const aviso = $('#aviso-update');
    aviso.hidden = false;
    $('#btn-recargar').onclick = () => {
      recargarAlCambiar = true;
      // Le pide al service worker nuevo que se active (skipWaiting en sw.js).
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
  }

  function pedirVersionSW() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({ type: 'VERSION' });
  }

  function registrarSW() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'VERSION') {
        const el = $('#version-app');
        if (el) el.textContent = 'Versión instalada: ' + e.data.version;
      }
    });

    // Cuando el SW nuevo toma el control, recargamos (solo si el usuario tocó "Recargar").
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!recargarAlCambiar) return;
      recargarAlCambiar = false;
      window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) mostrarAvisoUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          // "installed" con un controller existente = hay versión nueva esperando.
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) mostrarAvisoUpdate(nuevo);
        });
      });
      // Al volver a la app, buscar si hay versión nueva.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch((err) => console.warn('No se pudo registrar el service worker', err));
  }

  /* ==================================================================
     10. Arranque
     ================================================================== */

  function init() {
    const borrador = S.cargarBorrador();
    if (borrador) {
      state.sucio = !!borrador._sucio;
      delete borrador._sucio;
      state.pedido = completarPedido(borrador);
    } else {
      state.pedido = C.nuevoPedido(state.config, { telaId: telaPreferida() });
    }

    bindPedido();
    bindDialogos();
    bindHoja();
    bindPedidos();
    bindConfig();
    bindInstalar();

    renderPedidoCompleto();
    irA(tabDesdeHash());
    window.addEventListener('hashchange', () => irA(tabDesdeHash()));

    // Guardar el borrador si se cierra o se manda la app al fondo.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') guardarBorrador(true);
    });

    registrarSW();
  }

  init();
})();
