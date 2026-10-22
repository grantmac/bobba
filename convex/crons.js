import {cronJobs} from 'convex/server';
import {internal} from './_generated/api.js';
const crons=cronJobs();
crons.interval('Clean up agent pairing requests',{minutes:15},internal.agentPairing.cleanup,{});
crons.interval('Clean up room-key challenges and limits',{minutes:15},internal.identity.cleanup,{});
crons.interval('Maintain the resident bot and clean up old turns',{minutes:15},internal.bot.tick,{});
crons.interval('Clean up expired sessions and old chat',{hours:1},internal.room.cleanup,{});
export default crons;
