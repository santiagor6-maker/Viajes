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
| `especialistas` | `cultura-historia`, `naturaleza`, `gastronomia-vino` y `adrenalina`, una ejecución por grupo | `cruce` |
| `cruce` | Cada especialista puntúa los `nuevos` que agregaron los otros especialistas (sin esto quedan con 0 en su criterio) | `logistica` |
| `huecos` | Los especialistas que nombra `cobertura.json` agregan lo que falta y corrigen los puntajes señalados; también hacen el cruce de los nuevos. Después: `logistica` de los nuevos y `curador` | `logistica` |
| `fuentes` | Los especialistas completan las fuentes marcadas como no verificadas (ronda +1) | `logistica` o `curador` |
| `logistica` | `logistica-temporada` sobre los candidatos y los `nuevos` | `curador` |
| `curador` | `curador`: une, deduplica, puntúa y escribe `data/lugares/europa.json` | `cobertura` |
| `cobertura` | `evaluador-cobertura`. Si hay huecos, se ejecutan los especialistas indicados y luego el curador otra vez | `revisor` |
| `revisor` | `revisor-calidad`. Los agentes con nota < 9.5 se vuelven a ejecutar con los comentarios, hasta 3 rondas | `publicar` |
| `publicar` | `node scripts/construir-app.mjs` y republicar el artifact (misma URL); avisar al usuario con un resumen | siguiente subregión: `guias` |

Si una tanda no alcanza a terminar un paso por falta de cupo, el paso se repite en el siguiente despertar con lo que falte.

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
