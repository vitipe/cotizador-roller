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
| `manifest.json` | Datos para instalar la app |
| `icon.svg`, `icon-192.png`, `icon-512.png` | Ícono |

## Fórmulas (en `calc.js`)

- m² reales = ancho × alto ÷ 10.000 · m² facturables = el mayor entre m² reales y el mínimo
- Tubo/mecanismo: el primer rango cuyo "hasta" alcance el ancho
- Corte de tela = (ancho − desc. tela) × (alto + agregado)
- Tubo = ancho − desc. tubo · Contrapeso = ancho − desc. contrapeso · Cadena = alto × factor
- Costo = tela (m² facturables × $/m²) + tubo + mecanismo + contrapeso + cadena + mano de obra + adicionales activos
- Precio = costo × (1 + margen %)
- Cortes redondeados a 0,1 cm; precios a pesos enteros

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

1. Creá un repositorio en GitHub (por ejemplo `cotizador-roller`).
2. Subí todos los archivos a la raíz del repo (con "Add file → Upload files" o con git).
3. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)` → **Save**.
4. En uno o dos minutos queda en `https://TU-USUARIO.github.io/cotizador-roller/`.
5. Abrilo desde el celular y tocá **Instalar** (en iPhone: Safari → Compartir → Agregar a inicio).

## Subir una versión nueva

1. Hacé los cambios en los archivos.
2. En `sw.js` subí el número de versión: `const CACHE = 'roller-v1'` → `'roller-v2'` (la próxima, `v3`, etc.). **Si no lo cambiás, los teléfonos siguen usando los archivos viejos guardados.**
3. Subí los archivos al repo (commit + push). Esperá a que GitHub Pages termine de publicar.
4. Al abrir la app aparece **"Hay una actualización disponible"** → tocá **Recargar**. La versión instalada se ve al final de Configuración.

Si agregás un archivo nuevo a la app, sumalo también a la lista `ASSETS` de `sw.js`.

## Backup

Configuración → Backup → **Exportar backup** descarga un `.json` con la configuración y todos los pedidos. Los datos viven solo en ese teléfono/navegador: conviene exportar seguido y guardarlo en Drive o mandarlo por mail.
