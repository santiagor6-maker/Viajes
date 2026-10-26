#!/usr/bin/env node
// Curador: une, deduplica y puntúa los lugares de una subregión.
// Uso: node scripts/curar.mjs --subregion iberica-italia [--fecha AAAA-MM-DD] [--seco]
//
// Lee todos los data/trabajo/<subregion>/*.json (incluidos los partidos por grupo, p. ej. naturaleza-a.json)
// salvo curador.json y curador-ajustes.json. Las decisiones manuales del curador (fusiones, puntaje de
// guías de lugares nuevos, coordenadas corregidas, nombres, playa, textos por_que) van en
// data/trabajo/<subregion>/curador-ajustes.json:
// {
//   "fusiones":   [{ "destino": "pt-porto", "origenes": ["pt-vila-nova-de-gaia"], "nombre": "...", "lat": 0, "lng": 0, "region": "..." }],
//   "guias":      { "<id>": { "puntaje": 3, "fuentes": [{ "guia": "Lonely Planet", "url": "https://..." }] } },
//   "lugares":    { "<id>": { "nombre": "...", "lat": 0, "lng": 0, "region": "..." } },   // correcciones sueltas
//   "playa":      ["<id>"],      // añade la categoría playa
//   "no_playa":   ["<id>"],      // quita la playa deducida de tipo costa/playa
//   "ciudad":     ["<id>"],      // añade ciudad
//   "no_ciudad":  ["<id>"],
//   "por_que":    { "<id>": "2–3 frases en español" }
// }
// Escribe data/lugares/<continente>.json (solo reemplaza los países de la subregión) y
// data/trabajo/<subregion>/curador.json.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const subregion = opt('--subregion');
if (!subregion) { console.error('Falta --subregion'); process.exit(1); }
const fecha = opt('--fecha') || new Date().toISOString().slice(0, 10);
const seco = args.includes('--seco');

const leer = (p) => JSON.parse(readFileSync(join(raiz, p), 'utf8'));
const criterios = leer('data/criterios.json');
const TEMATICOS = criterios.formula_global.tematicos;
const CRITERIOS = ['guias', ...TEMATICOS, 'logistica'];

// ---------- continente y países de la subregión ----------
let continente = opt('--continente'), paisesDoc, sub;
for (const f of readdirSync(join(raiz, 'data/paises')).filter((f) => f.endsWith('.json'))) {
  const d = leer(`data/paises/${f}`);
  const s = d.subregiones?.find((x) => x.id === subregion);
  if (s && (!continente || continente === d.continente)) { continente = d.continente || f.replace('.json', ''); paisesDoc = d; sub = s; break; }
}
if (!sub) { console.error(`Subregión ${subregion} no encontrada en data/paises/`); process.exit(1); }
const paisesSub = new Set(sub.paises);
const nombrePais = Object.fromEntries(paisesDoc.paises.map((p) => [p.iso, p.nombre]));

// ---------- entrada ----------
const dirTrabajo = `data/trabajo/${subregion}`;
const ajustesRuta = join(raiz, dirTrabajo, 'curador-ajustes.json');
const aj = existsSync(ajustesRuta) ? JSON.parse(readFileSync(ajustesRuta, 'utf8')) : {};
const archivos = readdirSync(join(raiz, dirTrabajo))
  .filter((f) => f.endsWith('.json') && !/^curador/.test(f))
  .sort();

const AGENTE_A_CRITERIO = {
  'guias-expertas': 'guias', 'cultura-historia': 'cultura', naturaleza: 'naturaleza',
  'gastronomia-vino': 'gastronomia', adrenalina: 'adrenalina', 'logistica-temporada': 'logistica',
};
const agenteDe = (f, d) => d.agente || f.replace(/(-[a-z])?\.json$/, '');

const lugares = new Map(); // id -> registro intermedio
const reg = (id) => {
  if (!lugares.has(id)) lugares.set(id, { id, puntajes: {}, just: {}, fuentes: [], platos: [], actividades: [], tipos: [], origen: new Set() });
  return lugares.get(id);
};
const limpiarFuente = (s) => ({ guia: s.guia, url: s.url, _v: s.url_verificada === true ? 2 : s.url_verificada === false ? 0 : 1 });
const ponerPuntaje = (r, c, v) => { if (typeof v === 'number') r.puntajes[c] = Math.max(r.puntajes[c] ?? -1, v); };
const ponerBase = (r, e, prioridad) => {
  for (const k of ['nombre', 'pais_iso', 'region', 'lat', 'lng'])
    if (e[k] != null && (r[k] == null || prioridad > (r._prio?.[k] ?? -1))) { r[k] = e[k]; (r._prio ??= {})[k] = prioridad; }
  if (e.tipo) r.tipos.push(e.tipo);
};

for (const f of archivos) {
  const d = JSON.parse(readFileSync(join(raiz, dirTrabajo, f), 'utf8'));
  const agente = agenteDe(f, d);
  const crit = AGENTE_A_CRITERIO[agente];
  if (!crit) { console.warn(`  (ignoro ${f}: agente ${agente} desconocido)`); continue; }
  const esGuias = crit === 'guias';
  const filas = [
    ...(d.candidatos || []).map((e) => [e, false]),
    ...(d.puntajes || []).map((e) => [e, false]),
    ...(d.nuevos || []).map((e) => [e, true]),
    ...(d.logistica || []).map((e) => [e, false]),
  ];
  for (const [e, nuevo] of filas) {
    if (!e.id) continue;
    const r = reg(e.id);
    r.origen.add(agente + (nuevo ? '*' : ''));
    ponerBase(r, e, esGuias ? 2 : nuevo ? 1 : 0);
    ponerPuntaje(r, crit, e.puntaje);
    if (e.justificacion) (r.just[crit] ??= []).push(e.justificacion);
    if (e.actividad) (r.just.actividad ??= []).push(e.actividad);
    if (e.unesco) r.unesco = true;
    if (e.destino_propio) r.destino_propio = true;
    for (const p of e.platos || []) if (!r.platos.includes(p)) r.platos.push(p);
    for (const s of e.fuentes || []) if (s?.url) r.fuentes.push({ ...limpiarFuente(s), _g: esGuias ? 1 : 0 });
    for (const a of e.actividades || []) r.actividades.push(a);
    if (crit === 'logistica') {
      for (const k of ['mejor_epoca', 'dias_sugeridos', 'costo', 'acceso', 'alerta']) if (e[k] !== undefined) r[k] = e[k];
      if (e.temporada && !r.temporada) r.temporada = e.temporada;
    }
    if (e.temporada && !r.temporada) r.temporada = e.temporada;
  }
}

// ---------- ajustes: guías de lugares nuevos ----------
for (const [id, g] of Object.entries(aj.guias || {})) {
  if (!lugares.has(id)) { console.warn(`  ajuste guias para id inexistente ${id}`); continue; }
  const r = lugares.get(id);
  ponerPuntaje(r, 'guias', g.puntaje);
  for (const s of g.fuentes || []) r.fuentes.push({ ...limpiarFuente(s), _g: 1 });
}

// ---------- fusiones ----------
const R = 6371;
const km = (a, b) => {
  const toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const fusionados = [];
for (const fu of aj.fusiones || []) {
  const dst = lugares.get(fu.destino);
  if (!dst) { console.warn(`  fusión: destino ${fu.destino} no existe`); continue; }
  for (const oid of fu.origenes) {
    const o = lugares.get(oid);
    if (!o) { console.warn(`  fusión: origen ${oid} no existe`); continue; }
    for (const c of CRITERIOS) if (o.puntajes[c] != null) ponerPuntaje(dst, c, o.puntajes[c]);
    for (const [c, js] of Object.entries(o.just)) (dst.just[c] ??= []).push(...js);
    dst.fuentes.push(...o.fuentes);
    for (const p of o.platos) if (!dst.platos.includes(p)) dst.platos.push(p);
    dst.actividades.push(...o.actividades);
    dst.tipos.push(...o.tipos);
    for (const x of o.origen) dst.origen.add(x);
    if (o.unesco) dst.unesco = true;
    for (const k of ['mejor_epoca', 'dias_sugeridos', 'costo', 'acceso', 'alerta']) if (dst[k] == null && o[k] != null) dst[k] = o[k];
    (dst.fusion ??= []).push(oid);
    lugares.delete(oid);
    fusionados.push([fu.destino, oid]);
  }
  for (const k of ['nombre', 'lat', 'lng', 'region']) if (fu[k] != null) dst[k] = fu[k];
}
for (const [id, c] of Object.entries(aj.lugares || {})) {
  const r = lugares.get(id);
  if (!r) { console.warn(`  ajuste lugares: ${id} no existe`); continue; }
  Object.assign(r, c);
}

// ---------- cálculo ----------
const f = criterios.formula_global;
const niveles = [...criterios.niveles].sort((a, b) => b.min - a.min);
const redondear = (x) => Math.round(x * 10 ** f.redondeo) / 10 ** f.redondeo;
const set = (k) => new Set(aj[k] || []);
const playa = set('playa'), noPlaya = set('no_playa'), ciudad = set('ciudad'), noCiudad = set('no_ciudad');
const salida = [], descartados = [], sinPorQue = [];
// platos sin vacíos ni casi duplicados ("Vino de Oporto" / "Vino de Oporto (tawny…)"), máximo 6
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').trim();
function platosUnicos(lista, max = 6) {
  const out = [];
  for (const p of lista) {
    if (!p?.trim()) continue;
    const n = norm(p);
    if (out.some((q) => { const m = norm(q); return m.startsWith(n) || n.startsWith(m); })) continue;
    out.push(p);
  }
  return out.slice(0, max);
}

for (const r of lugares.values()) {
  if (!paisesSub.has(r.pais_iso)) { console.warn(`  ${r.id}: pais_iso ${r.pais_iso} fuera de la subregión, lo ignoro`); continue; }
  const p = Object.fromEntries(CRITERIOS.map((c) => [c, Math.max(0, r.puntajes[c] ?? 0)]));
  const mejor = Math.max(...TEMATICOS.map((t) => p[t]));
  const global = redondear(f.guias * p.guias + f.mejor_tematico * mejor + f.logistica * p.logistica);
  if (global < criterios.descartar_bajo) {
    descartados.push({ id: r.id, global, motivo: `global ${global} < ${criterios.descartar_bajo} (guías ${p.guias}, mejor temático ${mejor}, logística ${p.logistica})` });
    continue;
  }
  const nivel = niveles.find((n) => global >= n.min).id;

  const cats = TEMATICOS.filter((t) => p[t] >= 3.5);
  const tipoPlaya = r.tipos.some((t) => ['playa', 'costa'].includes(t));
  if ((tipoPlaya || playa.has(r.id)) && !noPlaya.has(r.id)) cats.push('playa');
  if ((r.tipos[0] === 'ciudad' || ciudad.has(r.id)) && !noCiudad.has(r.id)) cats.push('ciudad');
  if (!cats.length) cats.push(TEMATICOS.reduce((a, b) => (p[b] > p[a] ? b : a)));

  // fuentes: primero guías expertas, luego verificadas, luego el resto; sin duplicar url
  const vistos = new Set();
  const fuentes = [...r.fuentes]
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => b._g - a._g || b._v - a._v || a.i - b.i)
    .filter((s) => /^https?:\/\/\S+\.\S+/.test(s.url) && !vistos.has(s.url) && vistos.add(s.url))
    .map(({ guia, url }) => ({ guia, url }));

  // adrenalina cerca: km recalculado desde el lugar si hubo fusión; sin duplicados
  const acts = new Map();
  for (const a of r.actividades) {
    if (!a?.nombre || !/^https?:\/\//.test(a.url || '')) continue;
    const kmA = r.fusion && typeof a.lat === 'number' ? Math.round(km(r, a)) : a.km;
    const prev = acts.get(a.nombre);
    if (!prev || kmA < prev.km)
      acts.set(a.nombre, { nombre: a.nombre, tipo: a.tipo, km: kmA, lat: a.lat, lng: a.lng, ...(a.temporada ? { temporada: a.temporada } : {}), url: a.url });
  }
  const adrenalina_cerca = [...acts.values()].sort((a, b) => a.km - b.km);

  const porQue = aj.por_que?.[r.id];
  if (!porQue) sinPorQue.push(r.id);

  salida.push({
    id: r.id,
    nombre: r.nombre,
    pais_iso: r.pais_iso,
    pais: nombrePais[r.pais_iso] || r.pais_iso,
    region: r.region,
    lat: r.lat,
    lng: r.lng,
    categorias: cats,
    puntajes: p,
    global,
    nivel,
    mejor_epoca: r.mejor_epoca,
    dias_sugeridos: r.dias_sugeridos,
    costo: r.costo,
    acceso: r.acceso ?? null,
    alerta: r.alerta ?? null,
    platos: platosUnicos(r.platos),
    por_que: porQue || (r.just.cultura || r.just.naturaleza || r.just.gastronomia || r.just.guias || r.just.adrenalina || [''])[0],
    fuentes,
    adrenalina_cerca,
    investigado_en: fecha,
  });
}

// ---------- escritura ----------
const rutaLugares = `data/lugares/${continente}.json`;
const previos = existsSync(join(raiz, rutaLugares)) ? leer(rutaLugares) : [];
const todos = [...previos.filter((l) => !paisesSub.has(l.pais_iso)), ...salida]
  .sort((a, b) => a.pais_iso.localeCompare(b.pais_iso) || b.global - a.global || a.nombre.localeCompare(b.nombre, 'es'));
const conteo = {};
for (const l of salida) conteo[l.pais_iso] = (conteo[l.pais_iso] || 0) + 1;
const porNivel = {};
for (const l of salida) ((porNivel[l.pais_iso] ??= {})[l.nivel] = (porNivel[l.pais_iso][l.nivel] || 0) + 1);

if (!seco) {
  writeFileSync(join(raiz, rutaLugares), JSON.stringify(todos, null, 2) + '\n');
  writeFileSync(join(raiz, dirTrabajo, 'curador.json'), JSON.stringify({
    agente: 'curador', subregion, fecha, fusionados, descartados,
    conteo_por_pais: Object.fromEntries(sub.paises.map((iso) => [iso, conteo[iso] || 0])),
  }, null, 2) + '\n');
}
console.log(`${salida.length} lugares (${archivos.length} archivos leídos) → ${rutaLugares}${seco ? ' [seco]' : ''}`);
for (const iso of sub.paises) console.log(`  ${iso} ${conteo[iso] || 0}  ${JSON.stringify(porNivel[iso] || {})}`);
console.log(`  fusiones ${fusionados.length}, descartes ${descartados.length}`);
for (const d of descartados) console.log(`    descartado ${d.id}: ${d.motivo}`);
if (sinPorQue.length) console.log(`  sin por_que manual (${sinPorQue.length}): ${sinPorQue.join(', ')}`);
