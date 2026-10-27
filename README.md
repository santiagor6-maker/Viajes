# Atlas de Viajes

Mapa de Europa (y luego del mundo) con los lugares que vale la pena visitar en cada país. Los destinos los elige un equipo de agentes que se basa en las guías de viaje expertas. En el mapa marcas cada lugar como **Visitado** (con fecha), **Quiero ir** o **Tal vez**.

- **Artifact:** https://claude.ai/artifact/Rfg1Mfo9zWC8byYnaE1GFm
- **Código del artifact:** `app/index.html`. Usa Leaflet, Leaflet.markercluster, D3 y las fronteras de Natural Earth.
- **Tus marcas:** se guardan en la base de datos del artifact (colecciones `marcas` y `lugares_propios`), no en este repo. Por eso sobreviven cuando se republica con nuevos continentes.

## Criterios
Cada lugar recibe un puntaje de 0 a 5 en seis criterios. Los pesos, niveles y umbrales están en `data/criterios.json`.

| Criterio | Agente | Qué mide |
|---|---|---|
| Consenso de guías | `guias-expertas` | Lonely Planet, Rick Steves, DK Eyewitness, Fodor's, Frommer's, Rough Guides, Michelin Guide Vert, NatGeo, Moon, Bradt, Condé Nast, Time Out |
| Cultura e Historia | `cultura-historia` | UNESCO, arquitectura, museos, festivales |
| Naturaleza | `naturaleza` | Parques nacionales, paisajes, senderismo, playas |
| Gastronomía y Vino | `gastronomia-vino` | Michelin, World's 50 Best, TasteAtlas, regiones vinícolas |
| Adrenalina | `adrenalina` | Parques de diversiones, alpine coasters, tirolesas, bungee, parapente, canyoning, rafting, esquí (a ≤ 60 km) |
| Logística | `logistica-temporada` | Mejor época, días, costo, acceso, avisos de seguridad |

**Puntaje global** = 40 % guías + 45 % el mejor temático (cultura, naturaleza, gastronomía o adrenalina) + 15 % logística.

**Niveles:**
- **Imprescindible:** ≥ 4.0
- **Muy recomendado:** ≥ 3.0
- **Si hay tiempo:** ≥ 2.0
- Por debajo de 2.0, el lugar se descarta.

## Equipo de agentes
Las definiciones están en `.claude/agents/`.

1. **`guias-expertas`** propone los candidatos de cada país.
2. **`cultura-historia`, `naturaleza`, `gastronomia-vino`, `adrenalina` y `logistica-temporada`** trabajan en paralelo. Puntúan los candidatos y agregan los lugares que faltan.
3. **`curador`** une los resultados, elimina duplicados, calcula el puntaje y el nivel, y escribe `data/lugares/<continente>.json`.
4. **`evaluador-cobertura`** revisa la cantidad y la variedad de lugares:
   - Mínimo 10 por país y entre 20 y 30 en los países grandes. Los microestados llevan entre 3 y 6, con una justificación escrita.
   - Pide un buen reparto por regiones y variedad de categorías.
   - Si algo falta, devuelve el país a los especialistas con la lista concreta de lo que falta.
5. **`revisor-calidad`** califica de 0 a 10 la salida de cada agente:
   - Si la nota es menor a 9.5, el agente rehace su parte con los comentarios, hasta 2 rondas.
   - Si tras 2 rondas no llega, el país queda marcado como "revisión pendiente".
   - Las notas quedan en `data/revisiones/<continente>.json`.

Europa se investiga por subregiones, definidas en `data/paises/europa.json`. Los archivos intermedios de cada agente quedan en `data/trabajo/<subregion>/`.

## Scripts
```sh
node scripts/validar.mjs                  # valida formato, coordenadas, fórmula, cobertura y nota del revisor
node scripts/validar.mjs --sin-revision   # igual, sin exigir la nota del revisor
node scripts/validar.mjs --actualizar     # además recalcula total_lugares por país
node scripts/construir-app.mjs            # genera app/europa.json para el artifact
```

Las fronteras vienen de Natural Earth, que es de dominio público:
- `app/paises.geojson`: el mundo a escala 1:50m.
- `app/detalle-europa.geojson`: Europa a escala 1:10m.
