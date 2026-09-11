// Klient mot Enturs åpne API-er. Ruter publiserer alle rutedata og sanntid dit,
// så «Ruter-connectoren» snakker i praksis med Entur. Ingen API-nøkkel kreves,
// men Entur ber om en identifiserende ET-Client-Name-header.

// Entur ber alle konsumenter identifisere seg. Sett gjerne din egen med ET_CLIENT_NAME.
const CLIENT_NAME = process.env.ET_CLIENT_NAME ?? 'fredrsat-ruter-connector';
const GEOCODER_URL = 'https://api.entur.io/geocoder/v1/autocomplete';
const JOURNEY_PLANNER_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const TIMEOUT_MS = 15_000;

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { 'ET-Client-Name': CLIENT_NAME, ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Entur svarte ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

export interface Stoppested {
  id: string;
  navn: string;
  sted: string;
  kategorier: string[];
}

export async function finnStoppested(navn: string, antall: number): Promise<Stoppested[]> {
  const params = new URLSearchParams({
    text: navn,
    size: String(antall),
    lang: 'no',
    layers: 'venue', // kun holdeplasser/stasjoner, ikke adresser
  });
  const data = (await fetchJson(`${GEOCODER_URL}?${params}`)) as {
    features?: Array<{
      properties?: {
        id?: string;
        name?: string;
        locality?: string;
        county?: string;
        category?: string[];
      };
    }>;
  };
  return (data.features ?? []).flatMap((f) => {
    const p = f.properties;
    if (!p?.id || !p.name) return [];
    return [
      {
        id: p.id,
        navn: p.name,
        sted: [p.locality, p.county].filter(Boolean).join(', '),
        kategorier: [...new Set(p.category ?? [])],
      },
    ];
  });
}

const AVGANGER_QUERY = /* GraphQL */ `
  query Avganger($id: String!, $antall: Int!, $start: DateTime) {
    stopPlace(id: $id) {
      id
      name
      estimatedCalls(numberOfDepartures: $antall, startTime: $start) {
        realtime
        cancellation
        aimedDepartureTime
        expectedDepartureTime
        quay {
          publicCode
        }
        destinationDisplay {
          frontText
        }
        serviceJourney {
          line {
            publicCode
            transportMode
            authority {
              name
            }
          }
        }
        situations {
          summary {
            value
            language
          }
        }
      }
    }
  }
`;

interface EstimatedCall {
  realtime: boolean;
  cancellation: boolean;
  aimedDepartureTime: string;
  expectedDepartureTime: string;
  quay: { publicCode: string | null } | null;
  destinationDisplay: { frontText: string | null } | null;
  serviceJourney: {
    line: {
      publicCode: string | null;
      transportMode: string | null;
      authority: { name: string | null } | null;
    } | null;
  } | null;
  situations: Array<{ summary: Array<{ value: string; language: string | null }> }>;
}

export interface Avgang {
  linje: string;
  transportmiddel: string;
  destinasjon: string;
  plattform: string | null;
  planlagt: string;
  forventet: string;
  forsinkelse_minutter: number;
  sanntid: boolean;
  status: string;
  operatoer: string | null;
  avvik: string[];
}

export interface AvgangerResultat {
  stoppested: string;
  stoppested_id: string;
  hentet: string;
  avganger: Avgang[];
}

export interface AvgangerFilter {
  linje?: string;
  destinasjon?: string;
  antall: number;
  startTid?: string;
}

export async function hentAvganger(stoppestedId: string, filter: AvgangerFilter): Promise<AvgangerResultat> {
  // Ved filtrering henter vi flere avganger enn ønsket, siden filteret legges på etterpå.
  const harFilter = Boolean(filter.linje || filter.destinasjon);
  const data = (await fetchJson(JOURNEY_PLANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: AVGANGER_QUERY,
      variables: {
        id: stoppestedId,
        antall: harFilter ? Math.min(filter.antall * 10, 100) : filter.antall,
        // Entur tåler ikke startTime: null — send alltid et konkret tidspunkt
        start: filter.startTid ?? new Date().toISOString(),
      },
    }),
  })) as {
    errors?: Array<{ message: string }>;
    data?: { stopPlace: { id: string; name: string; estimatedCalls: EstimatedCall[] } | null };
  };

  if (data.errors?.length) {
    throw new Error(`GraphQL-feil fra Entur: ${data.errors.map((e) => e.message).join('; ')}`);
  }
  const stopPlace = data.data?.stopPlace;
  if (!stopPlace) {
    throw new Error(
      `Fant ikke stoppested med id «${stoppestedId}». Bruk finn_stoppested for å slå opp riktig NSR-id.`
    );
  }

  const linjeFilter = filter.linje?.trim().toLowerCase();
  const destFilter = filter.destinasjon?.trim().toLowerCase();

  const avganger = stopPlace.estimatedCalls
    .filter((call) => {
      const linje = call.serviceJourney?.line?.publicCode?.toLowerCase();
      const dest = call.destinationDisplay?.frontText?.toLowerCase();
      if (linjeFilter && linje !== linjeFilter) return false;
      if (destFilter && !(dest ?? '').includes(destFilter)) return false;
      return true;
    })
    .slice(0, filter.antall)
    .map((call) => tilAvgang(call));

  return {
    stoppested: stopPlace.name,
    stoppested_id: stopPlace.id,
    hentet: formaterTid(new Date().toISOString()),
    avganger,
  };
}

function tilAvgang(call: EstimatedCall): Avgang {
  const forsinkelseMs = Date.parse(call.expectedDepartureTime) - Date.parse(call.aimedDepartureTime);
  const forsinkelseMin = Math.round(forsinkelseMs / 60_000);

  let status: string;
  if (call.cancellation) status = 'innstilt';
  else if (!call.realtime) status = 'kun rutetid (ingen sanntidsdata)';
  else if (forsinkelseMin <= 0) status = 'i rute';
  else status = `${forsinkelseMin} min forsinket`;

  // Foretrekk norsk tekst i avviksmeldinger, fall tilbake til første tilgjengelige
  const avvik = call.situations.flatMap((s) => {
    const norsk = s.summary.find((t) => t.language === 'no' || t.language === 'nb');
    const tekst = norsk ?? s.summary[0];
    return tekst ? [tekst.value] : [];
  });

  return {
    linje: call.serviceJourney?.line?.publicCode ?? '?',
    transportmiddel: oversettTransportmiddel(call.serviceJourney?.line?.transportMode),
    destinasjon: call.destinationDisplay?.frontText ?? '?',
    plattform: call.quay?.publicCode || null,
    planlagt: formaterTid(call.aimedDepartureTime),
    forventet: formaterTid(call.expectedDepartureTime),
    forsinkelse_minutter: forsinkelseMin,
    sanntid: call.realtime,
    status,
    operatoer: call.serviceJourney?.line?.authority?.name ?? null,
    avvik,
  };
}

function formaterTid(iso: string): string {
  return new Date(iso).toLocaleString('nb-NO', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

function oversettTransportmiddel(mode: string | null | undefined): string {
  const map: Record<string, string> = {
    bus: 'buss',
    tram: 'trikk',
    metro: 't-bane',
    rail: 'tog',
    water: 'båt',
    coach: 'ekspressbuss',
    air: 'fly',
  };
  return mode ? (map[mode] ?? mode) : 'ukjent';
}
