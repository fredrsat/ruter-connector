// Røyktest mot Entur uten MCP-laget: npm run smoke
import { finnStoppested, hentAvganger } from './entur.js';

const treff = await finnStoppested('Jernbanetorget', 3);
console.log('finn_stoppested:', JSON.stringify(treff, null, 2));

const forste = treff[0];
if (!forste) throw new Error('Ingen treff fra geocoder');

const avganger = await hentAvganger(forste.id, { antall: 5 });
console.log('avganger:', JSON.stringify(avganger, null, 2));
