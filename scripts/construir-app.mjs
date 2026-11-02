#!/usr/bin/env node
// Empaqueta los datos de un continente para el artifact: app/<continente>.json
// Uso: node scripts/construir-app.mjs [--continente europa]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const i = args.indexOf('--continente');
const continente = i >= 0 ? args[i + 1] : 'europa';
const leer = (p) => JSON.parse(readFileSync(join(raiz, p), 'utf8'));

const paisesDoc = leer(`data/paises/${continente}.json`);
const rutaLugares = `data/lugares/${continente}.json`;
const lugares = existsSync(join(raiz, rutaLugares)) ? leer(rutaLugares) : [];
const criterios = leer('data/criterios.json');

// destacados: por país, los de mayor puntaje global (desempate: guías) con un máximo por región
const regionBase = (r) => (r || 'Otras').replace(/\s*\([^)]*\)/g, '').split(/\s*\/\s*/)[0].trim();
const dest = criterios.destacados;
const tamano = (iso) => (dest.grande.includes(iso) ? 'grande' : dest.pequeno.includes(iso) ? 'pequeno' : dest.micro.includes(iso) ? 'micro' : 'mediano');
const destacados = new Set(), cuentaDest = {};
for (const iso of new Set(lugares.map((l) => l.pais_iso))) {
  const t = tamano(iso), cupo = dest.cupo[t], maxRegion = dest.max_por_region[t];
  const ls = lugares.filter((l) => l.pais_iso === iso).sort((a, b) => b.global - a.global || b.puntajes.guias - a.puntajes.guias);
  const porRegion = new Map();
  let n = 0;
  for (const l of ls) {
    if (n >= cupo) break;
    const r = regionBase(l.region), k = porRegion.get(r) || 0;
    if (k >= maxRegion) continue;
    porRegion.set(r, k + 1); destacados.add(l.id); n++;
  }
  // países con pocas regiones (p. ej. Irlanda, 4 provincias): si el tope por región deja el cupo sin
  // llenar, se completa con los mejores restantes
  for (const l of ls) { if (n >= cupo) break; if (!destacados.has(l.id)) { destacados.add(l.id); n++; } }
  cuentaDest[iso] = n;
}

const paquete = {
  continente,
  generado: new Date().toISOString().slice(0, 10),
  niveles: criterios.niveles,
  subregiones: paisesDoc.subregiones,
  paises: paisesDoc.paises.map(({ iso, nombre, subregion, total_lugares, estado, nota_revisor, justificacion, revision_pendiente }) =>
    ({ iso, nombre, subregion, total_lugares, destacados: cuentaDest[iso] || 0, estado, nota_revisor, justificacion, revision_pendiente })),
  lugares: lugares.map(({ investigado_en, ...l }) => (destacados.has(l.id) ? { ...l, destacado: true } : l)),
};
writeFileSync(join(raiz, `app/${continente}.json`), JSON.stringify(paquete));
console.log(`app/${continente}.json: ${paquete.lugares.length} lugares, ${paquete.paises.length} países`);
