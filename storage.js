/* =====================================================================
   storage.js — Guardado en localStorage y backup en JSON
   ---------------------------------------------------------------------
   Todo lo que se guarda en el teléfono pasa por acá. Si localStorage
   no está disponible (modo privado, etc.) se usa memoria, así la app
   sigue andando aunque no guarde.
   ===================================================================== */
(function (global) {
  'use strict';

  const Calc = global.Calc;

  const KEYS = {
    config: 'roller.config',
    pedidos: 'roller.pedidos',
    borrador: 'roller.borrador'
  };

  const memoria = {};

  function leer(clave, porDefecto) {
    try {
      const txt = global.localStorage.getItem(clave);
      if (txt === null) return porDefecto;
      return JSON.parse(txt);
    } catch (e) {
      return clave in memoria ? memoria[clave] : porDefecto;
    }
  }

  function escribir(clave, valor) {
    try {
      global.localStorage.setItem(clave, JSON.stringify(valor));
      return true;
    } catch (e) {
      memoria[clave] = valor;
      return false;
    }
  }

  function esObjeto(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  /**
   * Mezcla lo guardado con los valores por defecto: si en una versión
   * nueva se agrega un campo, toma el valor de ejemplo sin pisar lo
   * que el usuario ya había cargado. Las listas se toman tal cual.
   */
  function mezclar(def, guardado) {
    if (Array.isArray(def)) return Array.isArray(guardado) ? guardado : Calc.clonar(def);
    if (esObjeto(def)) {
      const out = {};
      const g = esObjeto(guardado) ? guardado : {};
      Object.keys(def).forEach((k) => { out[k] = mezclar(def[k], g[k]); });
      return out;
    }
    return guardado === undefined || guardado === null ? def : guardado;
  }

  /** Config guardada (ya normalizada a números). */
  function cargarConfig() {
    const guardada = leer(KEYS.config, null);
    const mezclada = mezclar(Calc.DEFAULT_CONFIG, guardada);
    return Calc.normalizarConfig(mezclada).cfg;
  }

  function guardarConfig(cfg) {
    return escribir(KEYS.config, cfg);
  }

  function cargarPedidos() {
    const lista = leer(KEYS.pedidos, []);
    return Array.isArray(lista) ? lista.filter((p) => esObjeto(p) && p.id) : [];
  }

  function guardarPedidos(lista) {
    return escribir(KEYS.pedidos, lista);
  }

  function cargarBorrador() {
    const b = leer(KEYS.borrador, null);
    return esObjeto(b) && Array.isArray(b.cortinas) ? b : null;
  }

  function guardarBorrador(pedido) {
    return escribir(KEYS.borrador, pedido);
  }

  /* ---------------- Backup ---------------- */

  /** Arma el objeto de backup con toda la información. */
  function armarBackup() {
    return {
      app: 'cotizador-roller',
      version: 1,
      exportado: new Date().toISOString(),
      config: cargarConfig(),
      pedidos: cargarPedidos()
    };
  }

  /** Descarga el backup como archivo .json */
  function exportarTodo() {
    const datos = JSON.stringify(armarBackup(), null, 2);
    const blob = new Blob([datos], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const hoy = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'roller-backup-' + hoy + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * Valida un backup leído de un archivo. Devuelve
   * { ok, msg, config, pedidos } sin guardar nada todavía.
   */
  function validarBackup(texto) {
    let obj;
    try {
      obj = JSON.parse(texto);
    } catch (e) {
      return { ok: false, msg: 'El archivo no es un JSON válido.' };
    }
    if (!esObjeto(obj)) return { ok: false, msg: 'El archivo no tiene el formato esperado.' };
    const tieneConfig = esObjeto(obj.config);
    const tienePedidos = Array.isArray(obj.pedidos);
    if (!tieneConfig && !tienePedidos) {
      return { ok: false, msg: 'El archivo no tiene configuración ni pedidos.' };
    }
    const config = tieneConfig
      ? Calc.normalizarConfig(mezclar(Calc.DEFAULT_CONFIG, obj.config)).cfg
      : null;
    const pedidos = tienePedidos
      ? obj.pedidos.filter((p) => esObjeto(p) && p.id && Array.isArray(p.cortinas))
      : null;
    return { ok: true, config, pedidos };
  }

  /** Reemplaza lo guardado por el contenido de un backup ya validado. */
  function aplicarBackup(b) {
    if (b.config) guardarConfig(b.config);
    if (b.pedidos) guardarPedidos(b.pedidos);
  }

  global.Store = {
    cargarConfig,
    guardarConfig,
    cargarPedidos,
    guardarPedidos,
    cargarBorrador,
    guardarBorrador,
    exportarTodo,
    validarBackup,
    aplicarBackup
  };
})(window);
