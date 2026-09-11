// MCP-server (stdio) som lar agenter sjekke om bussen/trikken/t-banen er i rute.
// Data kommer fra Enturs åpne API-er, der Ruter publiserer rutedata og sanntid.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { finnStoppested, hentAvganger } from './entur.js';

const server = new McpServer({ name: 'ruter', version: '1.0.0' });

function somTekst(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function somFeil(err: unknown) {
  return {
    content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

server.registerTool(
  'finn_stoppested',
  {
    title: 'Finn stoppested',
    description:
      'Søk etter holdeplass/stasjon i Norge etter navn (f.eks. «Jernbanetorget» eller «Nydalen»). ' +
      'Returnerer NSR-id-er som brukes i avganger-verktøyet. Bruk alltid dette først hvis du ikke kjenner id-en.',
    inputSchema: {
      navn: z.string().min(2).describe('Navn på holdeplass eller stasjon, f.eks. «Majorstuen»'),
      antall: z.number().int().min(1).max(20).default(5).describe('Maks antall treff'),
    },
  },
  async ({ navn, antall }) => {
    try {
      const treff = await finnStoppested(navn, antall);
      if (treff.length === 0) {
        return somTekst({ melding: `Ingen stoppesteder funnet for «${navn}». Prøv et annet navn.` });
      }
      return somTekst(treff);
    } catch (err) {
      return somFeil(err);
    }
  }
);

server.registerTool(
  'avganger',
  {
    title: 'Sanntidsavganger',
    description:
      'Hent avganger fra et stoppested med sanntidsinfo: planlagt vs. forventet tid, forsinkelse i minutter ' +
      'og eventuelle avviksmeldinger. Svarer på «er bussen i rute?». Bruk NSR-id fra finn_stoppested ' +
      '(f.eks. «NSR:StopPlace:58366»). Kan filtreres på linjenummer og/eller destinasjon.',
    inputSchema: {
      stoppested_id: z
        .string()
        .regex(/^NSR:/, 'Må være en NSR-id, f.eks. NSR:StopPlace:58366')
        .describe('NSR-id fra finn_stoppested'),
      linje: z.string().optional().describe('Filtrer på linjenummer, f.eks. «31» eller «L2»'),
      destinasjon: z.string().optional().describe('Filtrer på destinasjon (delvis match), f.eks. «Fornebu»'),
      antall: z.number().int().min(1).max(20).default(10).describe('Maks antall avganger'),
      tidspunkt: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('Hent avganger fra dette tidspunktet (ISO 8601). Utelat for «nå».'),
    },
  },
  async ({ stoppested_id, linje, destinasjon, antall, tidspunkt }) => {
    try {
      const resultat = await hentAvganger(stoppested_id, {
        linje,
        destinasjon,
        antall,
        startTid: tidspunkt,
      });
      if (resultat.avganger.length === 0) {
        return somTekst({
          ...resultat,
          melding:
            'Ingen avganger funnet. Sjekk at eventuelle filtre (linje/destinasjon) stemmer med det som ' +
            'faktisk går fra stoppestedet.',
        });
      }
      return somTekst(resultat);
    } catch (err) {
      return somFeil(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
