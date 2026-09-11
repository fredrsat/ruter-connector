# ruter-connector

**Er bussen i rute?** En MCP-server som gir AI-agenter sanntidsdata for norsk
kollektivtrafikk — buss, trikk, t-bane, tog og båt.

Dataene hentes fra [Enturs åpne API-er](https://developer.entur.org/), dit Ruter og alle
andre norske kollektivselskaper publiserer rutedata og sanntid. Det betyr at connectoren
dekker **hele Norge**, ikke bare Ruter-området: Skyss i Bergen, AtB i Trondheim, Kolumbus
i Stavanger, alle togselskapene — alt sammen. Ingen API-nøkkel kreves.

## Verktøy

### `finn_stoppested`

Søker etter holdeplass eller stasjon på navn og returnerer NSR-id-er (Nasjonalt
stoppestedsregister) som brukes videre i `avganger`.

```json
{ "navn": "Nydalen", "antall": 2 }
```

```json
[
  { "id": "NSR:StopPlace:59605", "navn": "Nydalen", "sted": "Oslo, Oslo", "kategorier": ["metroStation", "onstreetBus"] },
  { "id": "NSR:StopPlace:31393", "navn": "Nydalen", "sted": "Bergen, Vestland", "kategorier": ["onstreetBus"] }
]
```

### `avganger`

Sanntidsavganger fra et stoppested: planlagt vs. forventet tid, forsinkelse i minutter,
status og eventuelle avviksmeldinger. Kan filtreres på linjenummer og/eller destinasjon,
og ta et starttidspunkt (ISO 8601) for oppslag frem i tid.

```json
{ "stoppested_id": "NSR:StopPlace:58366", "linje": "19", "antall": 1 }
```

```json
{
  "stoppested": "Jernbanetorget",
  "stoppested_id": "NSR:StopPlace:58366",
  "hentet": "11.9., 21:23",
  "avganger": [
    {
      "linje": "19",
      "transportmiddel": "trikk",
      "destinasjon": "Majorstuen",
      "plattform": "C",
      "planlagt": "11.9., 21:27",
      "forventet": "11.9., 21:29",
      "forsinkelse_minutter": 3,
      "sanntid": true,
      "status": "3 min forsinket",
      "operatoer": "Ruter",
      "avvik": []
    }
  ]
}
```

`status` er én av: `i rute`, `N min forsinket`, `innstilt` eller
`kun rutetid (ingen sanntidsdata)` — det siste når avgangen ikke rapporterer sanntid ennå.

Typisk agentflyt: `finn_stoppested("Jernbanetorget")` → `avganger("NSR:StopPlace:58366", linje: "19")`.

## Kom i gang

Krever Node.js 18+.

```sh
git clone https://github.com/fredrsat/ruter-connector.git
cd ruter-connector
npm install
npm run smoke   # røyktest mot Entur uten MCP-laget
```

## Bruk med en MCP-klient

Serveren snakker MCP over stdio og fungerer med alle MCP-klienter
(Claude Desktop, Claude Code, AI SDK, m.fl.):

```json
{
  "mcpServers": {
    "ruter": {
      "command": "npx",
      "args": ["tsx", "/absolutt/sti/til/ruter-connector/src/index.ts"]
    }
  }
}
```

I Claude Code: `claude mcp add ruter -- npx tsx /absolutt/sti/til/ruter-connector/src/index.ts`

## Konfigurasjon

| Miljøvariabel | Standard | Beskrivelse |
|---|---|---|
| `ET_CLIENT_NAME` | `fredrsat-ruter-connector` | Entur ber alle konsumenter identifisere seg med en `ET-Client-Name`-header på formen `firma-applikasjon`. Sett din egen hvis du kjører dette selv. |

## Datakilder og lisens

- Stoppestedssøk: [Entur Geocoder](https://developer.entur.org/pages-geocoder-intro)
- Avganger og sanntid: [Entur JourneyPlanner v3](https://developer.entur.org/pages-journeyplanner-journeyplanner) (GraphQL)

Dataene er lisensiert under [NLOD](https://data.norge.no/nlod/no) av Entur.
Koden i dette repoet er MIT-lisensiert, se [LICENSE](LICENSE).
