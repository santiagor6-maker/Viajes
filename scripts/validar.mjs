#!/usr/bin/env node
// Valida los datos de un continente contra data/criterios.json.
// Uso: node scripts/validar.mjs [--continente europa] [--paises IT,ES] [--sin-revision] [--actualizar]
//   --sin-revision  no exige nota del revisor (lo usa el curador antes de la revisión)
//   --actualizar    escribe total_lugares y estado en data/paises/<continente>.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const continente = opt('--continente') || 'europa';
const soloPaises = opt('--paises')?.split(',').map((s) => s.trim().toUpperCase()) ?? null;
const sinRevision = args.includes('--sin-revision');
const actualizar = args.includes('--actualizar');

const leer = (p) => JSON.parse(readFileSync(join(raiz, p), 'utf8'));
const criterios = leer('data/criterios.json');
const geo = leer('app/paises.geojson');
const rutaLugares = `data/lugares/${continente}.json`;
const rutaPaises = `data/paises/${continente}.json`;
const lugares = existsSync(join(raiz, rutaLugares)) ? leer(rutaLugares) : [];
const paisesDoc = leer(rutaPaises);

const errores = [];
const avisos = [];
const err = (id, m) => errores.push(`${id}: ${m}`);
const aviso = (id, m) => avisos.push(`${id}: ${m}`);

// ---------- geometría ----------
const geomPorIso = Object.fromEntries(geo.features.map((f) => [f.properties.iso, f.geometry]));
// fronteras 1:10m del continente, más precisas en costas e islas
const rutaDetalle = `app/detalle-${continente}.geojson`;
if (existsSync(join(raiz, rutaDetalle))) for (const f of leer(rutaDetalle).features) geomPorIso[f.properties.iso] = f.geometry;
const poligonos = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
function enAnillo([x, y], anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
const enGeom = (pt, g) => poligonos(g).some(([ext, ...huecos]) => enAnillo(pt, ext) && !huecos.some((h) => enAnillo(pt, h)));
function kmASegmento([lng, lat], a, b) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  const px = 0, py = 0;
  const ax = (a[0] - lng) * kx, ay = (a[1] - lat) * ky, bx = (b[0] - lng) * kx, by = (b[1] - lat) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
function kmABorde(pt, g) {
  let min = Infinity;
  for (const pol of poligonos(g)) for (const anillo of pol)
    for (let i = 1; i < anillo.length; i++) min = Math.min(min, kmASegmento(pt, anillo[i - 1], anillo[i]));
  return min;
}
const TOLERANCIA_KM = 25; // costas, islas pequeñas y microestados simplificados a 1:50m

// ---------- lugares ----------
const f = criterios.formula_global;
const niveles = [...criterios.niveles].sort((a, b) => b.min - a.min);
const categorias = new Set(criterios.categorias);
const costos = new Set(criterios.costos);
const isoValidos = new Set(paisesDoc.paises.map((p) => p.iso));
const ids = new Set();
const porPais = {};

const filtrados = soloPaises ? lugares.filter((l) => soloPaises.includes(l.pais_iso)) : lugares;
if (!Array.isArray(lugares)) err(rutaLugares, 'debe ser un array');

for (const l of filtrados) {
  const id = l.id || '(sin id)';
  for (const c of ['id', 'nombre', 'pais_iso', 'pais', 'region', 'por_que', 'nivel', 'costo', 'investigado_en'])
    if (typeof l[c] !== 'string' || !l[c].trim()) err(id, `falta ${c}`);
  if (ids.has(id)) err(id, 'id repetido');
  ids.add(id);
  if (!/^[a-z]{2}-[a-z0-9-]+$/.test(id)) err(id, 'id debe ser <iso2>-<slug-ascii>');
  else if (id.slice(0, 2) !== l.pais_iso?.toLowerCase()) err(id, `el prefijo del id no coincide con pais_iso ${l.pais_iso}`);
  if (!isoValidos.has(l.pais_iso)) err(id, `pais_iso ${l.pais_iso} no está en ${rutaPaises}`);
  (porPais[l.pais_iso] ??= []).push(l);

  // coordenadas
  if (typeof l.lat !== 'number' || typeof l.lng !== 'number' || Math.abs(l.lat) > 90 || Math.abs(l.lng) > 180) err(id, 'lat/lng inválidos');
  else if (geomPorIso[l.pais_iso]) {
    const pt = [l.lng, l.lat];
    if (!enGeom(pt, geomPorIso[l.pais_iso])) {
      const d = kmABorde(pt, geomPorIso[l.pais_iso]);
      if (d > TOLERANCIA_KM) err(id, `coordenadas fuera de ${l.pais_iso} (a ${d.toFixed(0)} km del borde)`);
      else if (d > 3) aviso(id, `coordenadas ${d.toFixed(1)} km fuera del contorno de ${l.pais_iso} (tolerado)`);
    }
  }

  // puntajes y fórmula
  const p = l.puntajes || {};
  for (const c of ['guias', ...f.tematicos, 'logistica'])
    if (typeof p[c] !== 'number' || p[c] < 0 || p[c] > 5) err(id, `puntaje ${c} debe ser número 0–5`);
  const esperado = Math.round((f.guias * p.guias + f.mejor_tematico * Math.max(...f.tematicos.map((t) => p[t])) + f.logistica * p.logistica) * 10) / 10;
  if (Math.abs(esperado - l.global) > 0.051) err(id, `global ${l.global} ≠ fórmula ${esperado}`);
  if (l.global < criterios.descartar_bajo) err(id, `global ${l.global} < ${criterios.descartar_bajo}: debería descartarse`);
  const nivelEsperado = niveles.find((n) => l.global >= n.min)?.id;
  if (nivelEsperado && l.nivel !== nivelEsperado) err(id, `nivel ${l.nivel} ≠ ${nivelEsperado}`);

  if (!Array.isArray(l.categorias) || !l.categorias.length) err(id, 'categorias vacío');
  else for (const c of l.categorias) if (!categorias.has(c)) err(id, `categoría desconocida ${c}`);
  if (!costos.has(l.costo)) err(id, `costo ${l.costo} inválido`);
  if (!Array.isArray(l.mejor_epoca) || !l.mejor_epoca.length || l.mejor_epoca.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) err(id, 'mejor_epoca debe ser meses 1–12');
  if (!Number.isInteger(l.dias_sugeridos) || l.dias_sugeridos < 1) err(id, 'dias_sugeridos debe ser entero ≥ 1');

  // fuentes
  if (!Array.isArray(l.fuentes) || !l.fuentes.length) err(id, 'sin fuentes');
  else for (const s of l.fuentes) if (!s.guia || !/^https?:\/\/\S+\.\S+/.test(s.url || '')) err(id, `fuente inválida ${JSON.stringify(s)}`);
  for (const a of l.adrenalina_cerca || []) {
    if (!a.nombre || !a.tipo || typeof a.km !== 'number' || !/^https?:\/\//.test(a.url || '')) err(id, `adrenalina_cerca inválida: ${a.nombre || '?'}`);
    if (a.km > criterios.criterios.adrenalina.radio_km * 1.5) aviso(id, `${a.nombre} está a ${a.km} km (radio ${criterios.criterios.adrenalina.radio_km})`);
  }
}

// ---------- países ----------
const cob = criterios.cobertura;
const grandes = new Set(cob.objetivo_paises_grandes.paises);
const micro = new Set(cob.microestados.paises);
const umbral = criterios.revisor.umbral;
for (const p of paisesDoc.paises) {
  if (soloPaises && !soloPaises.includes(p.iso)) continue;
  const n = porPais[p.iso]?.length || 0;
  if (actualizar) { p.total_lugares = n; if (n && p.estado === 'sin_investigar') p.estado = 'investigado'; }
  if (!n) { if (p.estado !== 'sin_investigar') err(p.iso, `estado ${p.estado} pero 0 lugares`); continue; }
  if (p.total_lugares !== n) err(p.iso, `total_lugares ${p.total_lugares} ≠ ${n} (usa --actualizar)`);
  const min = micro.has(p.iso) ? cob.microestados.min : cob.minimo_por_pais;
  if (n < min && !(p.excepcion_minimo && p.justificacion)) err(p.iso, `${n} lugares < mínimo ${min} sin excepción justificada`);
  if (micro.has(p.iso) && !p.justificacion) err(p.iso, 'microestado sin justificación escrita');
  if (grandes.has(p.iso) && n < cob.objetivo_paises_grandes.min) aviso(p.iso, `${n} lugares; objetivo ${cob.objetivo_paises_grandes.min}–${cob.objetivo_paises_grandes.max}`);
  const cats = new Set(porPais[p.iso].flatMap((l) => l.categorias || []));
  if (!micro.has(p.iso) && cats.size < cob.min_categorias_distintas) err(p.iso, `solo ${cats.size} categorías distintas`);
  if (!sinRevision) {
    if (p.revision_pendiente) aviso(p.iso, 'marcado como revisión pendiente');
    else if (typeof p.nota_revisor !== 'number') err(p.iso, 'sin nota del revisor');
    else if (p.nota_revisor < umbral) err(p.iso, `nota del revisor ${p.nota_revisor} < ${umbral}`);
  }
}
if (actualizar) writeFileSync(join(raiz, rutaPaises), JSON.stringify(paisesDoc, null, 2) + '\n');

// ---------- reporte ----------
const resumen = Object.entries(porPais).map(([iso, l]) => `${iso} ${l.length}`).join(' · ');
console.log(`${filtrados.length} lugares en ${Object.keys(porPais).length} países${resumen ? `: ${resumen}` : ''}`);
for (const a of avisos) console.log(`  aviso  ${a}`);
for (const e of errores) console.log(`  ERROR  ${e}`);
console.log(errores.length ? `\n✗ ${errores.length} errores, ${avisos.length} avisos` : `\n✓ sin errores (${avisos.length} avisos)`);
process.exit(errores.length ? 1 : 0);
