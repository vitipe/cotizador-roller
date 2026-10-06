# Cotizador Roller

PWA para cotizar cortinas roller y generar la hoja de corte del taller.
HTML, CSS y JS puros, sin dependencias. Funciona sin internet una vez abierta.

## Archivos

| Archivo | Qué tiene |
|---|---|
| `index.html` | Estructura de la app y registro del service worker |
| `styles.css` | Diseño (celular primero) y estilos de impresión |
| `calc.js` | **Toda la lógica de cálculo** (fórmulas, redondeos, formatos, textos). Si hay que cambiar una cuenta, es acá |
| `storage.js` | Guardado en el teléfono (localStorage) y backup JSON |
| `app.js` | Pantallas y botones |
| `sw.js` | Service worker (modo offline y actualizaciones) |
| `tests/calc.test.js` | Pruebas automáticas de las cuentas |
| `.github/workflows/publicar.yml` | Publicación automática en GitHub Pages |
| `manifest.json` | Datos para instalar la app |
| `icon.svg`, `icon-192.png`, `icon-512.png` | Ícono |

## Fórmulas (en `calc.js`)

- **Medida final:** ancho × alto, o con **3 puntos** la más chica de cada medida (dentro del vano) o la más grande (fuera del vano)
- m² reales = ancho × alto ÷ 10.000 · m² facturables = el mayor entre m² reales y el mínimo
- Tubo/mecanismo: el primer rango cuyo "hasta" alcance el ancho
- Corte de tela = (ancho − desc. tela) × (alto + agregado). Si no entra en el rollo y la tela "se puede cortar girada", se gira
- Tubo = ancho − desc. tubo · Contrapeso = ancho − desc. contrapeso · Cadena = alto × factor
- **Tela** (a elección): m² facturables, tela cortada o ancho de rollo completo; con mínimo y % de desperdicio
- **Tubo** (a elección): por metro usado, o por barra entera (se arman las barras del pedido aprovechando sobrantes y el costo se reparte entre las cortinas)
- Costo = tela + tubo + mecanismo + contrapeso + cadena + mano de obra + adicionales activos
- Precio = costo × (1 + margen %), redondeado hacia arriba al múltiplo elegido (opcional)
- Cortes redondeados a 0,1 cm; precios a pesos enteros

## Pruebas automáticas

```bash
npm test
```
No hay que instalar nada (usa el `node:test` que trae Node 18 o más nuevo). Cubren las cuentas, los formatos, los casos con datos vacíos y que la lista de archivos del service worker esté completa. Si cambiás una fórmula, agregá o ajustá un test.

## Probar en la compu

```bash
python3 -m http.server 8080
```
Abrir http://localhost:8080 (el service worker necesita `localhost` o `https`).

## Ícono: exportar el SVG a PNG

Los PNG ya vienen generados. Si cambiás `icon.svg`, exportalo de nuevo a `icon-192.png` (192×192) e `icon-512.png` (512×512), de alguna de estas formas:

- **Online:** abrí https://svgtopng.com (o similar), subí `icon.svg` y descargá en 192 y 512 px.
- **Inkscape:** Archivo → Exportar → PNG, ancho 192 (y después 512).
- **Terminal** (con `librsvg` instalado: `brew install librsvg`):
  ```bash
  rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
  rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
  ```

El dibujo tiene que quedar dentro del 80 % central y el fondo cubrir todo el cuadrado: así el mismo `icon-512.png` sirve como ícono "maskable" (Android lo recorta en círculo o en otras formas).

## Publicar en GitHub Pages

La publicación la hace GitHub Actions (`.github/workflows/publicar.yml`) cada vez que se sube algo a `main`:

1. Corre `npm test`. **Si alguna prueba falla, no se publica nada.**
2. Pone una versión de caché nueva en `sw.js` (fecha + commit), así los teléfonos ven el aviso de actualización.
3. Publica solo los archivos de la app.

Configuración del repo (una sola vez): **Settings → Pages → Build and deployment → Source: GitHub Actions**.

La app queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`. En el celular: **Instalar** (en iPhone: Safari → Compartir → Agregar a inicio).

## Subir una versión nueva

1. Hacé los cambios y corré `npm test`.
2. `git add -A && git commit -m "..." && git push`
3. En **Actions** del repo se ve la publicación (tarda 1–2 minutos).
4. Al abrir la app aparece **"Hay una actualización disponible"** → **Recargar**. La versión instalada se ve al final de Configuración.

**No hace falta tocar el número de versión**: en el repo `sw.js` dice `roller-dev` y el workflow lo reemplaza al publicar.
Si agregás un archivo nuevo a la app, sumalo a `ASSETS` en `sw.js` y a la línea `cp` del workflow (hay un test que avisa si quedan distintos).

## Backup

Configuración → Backup → **Exportar backup** descarga un `.json` con la configuración y todos los pedidos. Los datos viven solo en ese teléfono/navegador: conviene exportar seguido y guardarlo en Drive o mandarlo por mail.
