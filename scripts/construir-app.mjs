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

const paquete = {
  continente,
  generado: new Date().toISOString().slice(0, 10),
  niveles: criterios.niveles,
  subregiones: paisesDoc.subregiones,
  paises: paisesDoc.paises.map(({ iso, nombre, subregion, total_lugares, estado, nota_revisor, justificacion, revision_pendiente }) =>
    ({ iso, nombre, subregion, total_lugares, estado, nota_revisor, justificacion, revision_pendiente })),
  lugares: lugares.map(({ investigado_en, ...l }) => l),
};
writeFileSync(join(raiz, `app/${continente}.json`), JSON.stringify(paquete));
console.log(`app/${continente}.json: ${paquete.lugares.length} lugares, ${paquete.paises.length} países`);
