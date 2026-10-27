# Orquestador automático

La investigación avanza sola, una **tanda** por turno. Cada turno tiene un cupo de unas 200 búsquedas web, compartido por todos los agentes. Al terminar una tanda, el orquestador (la sesión principal de Claude) se programa con `send_later` un mensaje "Orquestador: siguiente tanda" un par de minutos después. Ese mensaje abre un turno nuevo con cupo fresco.

El estado vive en `data/trabajo/estado.json`. Es la única fuente de verdad sobre qué toca hacer.

## Qué hacer en cada despertar
1. Leer `data/trabajo/estado.json` y este archivo.
2. Si `pausado` es `true`, no hacer nada ni reprogramar.
3. Ejecutar el `paso` actual de la `subregion` actual (tabla de abajo).
   - Repartir el cupo de búsquedas entre los agentes de la tanda: el total debe ser ≤ 170. Hay que decirle a cada agente su máximo en el prompt.
   - Esperar a que terminen todos los agentes de la tanda.
4. Validar con `node scripts/validar.mjs --sin-revision` cuando haya datos en `data/lugares/`.
5. Actualizar `estado.json`:
   - el paso siguiente;
   - la ronda;
   - una línea en `historial`.
6. Hacer commit y push a `claude/clever-cannon-d4qyot`.
7. Programar el siguiente despertar con `send_later` a 2 minutos, salvo en dos casos:
   - el estado quedó en `terminado`;
   - hay una pregunta para el usuario.

## Pasos por subregión

| Paso | Qué se hace | Siguiente |
|---|---|---|
| `guias` | `guias-expertas`, una ejecución por grupo de países | `especialistas` |
| `especialistas` | `cultura-historia`, `naturaleza`, `gastronomia-vino` y `adrenalina`, una ejecución por grupo. Cada uno sabe qué lugares están proponiendo los otros (ver abajo) | `logistica` |
| `logistica` | En la misma tanda: `logistica-temporada` sobre candidatos y `nuevos`, y la **puntuación cruzada**: cada especialista puntúa los `nuevos` de los otros (`<agente>-cruce.json`, pocas búsquedas). Sin el cruce, los nuevos quedan con 0 en los demás criterios | `curador` |
| `huecos` | Los especialistas que nombra `cobertura.json` agregan lo que falta y corrigen los puntajes señalados; en la misma tanda se hace la logística y el cruce de esos nuevos | `curador` |
| `curador` | `curador`: une, deduplica, puntúa y escribe `data/lugares/europa.json` | `cobertura` |
| `cobertura` | `evaluador-cobertura` (una sola vez por subregión). Si hay huecos → `huecos` y luego el curador otra vez | `huecos` o `revisor` |
| `revisor` | `revisor-calidad`, una ejecución por grupo, escribe `revision-<grupo>-r<n>.json`; el orquestador los une en `data/revisiones/<continente>.json` | `correcciones` o `publicar` |
| `correcciones` | Un agente por especialidad con nota < 9.5 corrige lo señalado en ambos grupos y escribe `<agente>-fix<n>.json` con `"ronda": 3 + n` (así reemplaza puntajes anteriores). Luego `curador` y otra vez `revisor`. **Máximo 2 rondas del revisor** (decisión del usuario, 2026-10-27): tras la ronda 2 no hay más correcciones; los países que sigan < 9.5 quedan `revision_pendiente` con su nota | `curador` |
| `publicar` | `node scripts/construir-app.mjs` y republicar el artifact (misma URL); avisar al usuario con un resumen | siguiente subregión: `guias` |

Si una tanda no alcanza a terminar un paso por falta de cupo, el paso se repite en el siguiente despertar con lo que falte.

Para evitar duplicados y lugares sin puntuar, el prompt de cada especialista lista los lugares que ya existen (candidatos de `guias-expertas`) y le pide que, si agrega uno nuevo, revise primero que no esté. Lecciones de `iberica-italia` que aplican desde el inicio:
- Fuentes específicas desde la primera ronda: la ficha UNESCO de cada sitio (no la lista del país), páginas de Michelin y no la lista de Wikipedia, consejos reguladores para el vino y operadores oficiales para adrenalina. Nada de foros, librerías ni contenido pagado.
- Regla de adrenalina: cuenta todo lo que esté a 60 km o menos. Monumentos, museos y sitios religiosos tienen máximo 2 salvo que la actividad esté en el lugar. Espacios naturales que solo se recorren a pie, máximo 3.
- El curador busca el puntaje de guías de **todos** los lugares nuevos; ninguno queda en 0 sin buscar.

## Grupos de países por subregión
Los grupos dividen el trabajo para que cada agente tenga un tamaño razonable.

| Subregión | Grupo a | Grupo b |
|---|---|---|
| `iberica-italia` | ES, PT, AD | IT, MT, SM, VA |
| `francia-alpes` | FR, MC, BE, NL, LU | CH, AT, LI |
| `britanicas-nordicos` | GB, IE, IS | NO, SE, FI, DK, EE, LV, LT |
| `centroeuropa` | DE, PL | CZ, SK, HU, SI |
| `balcanes-grecia` | HR, BA, RS, ME, XK, AL, MK | GR, CY, BG, RO |
| `este-caucaso-turquia` | UA, MD, BY, RU | GE, AM, AZ, TR |

## Para pausar
Pon `"pausado": true` en `data/trabajo/estado.json`, o pídeselo a Claude en la conversación.
