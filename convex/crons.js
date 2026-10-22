import {cronJobs} from 'convex/server';
import {internal} from './_generated/api.js';
const crons=cronJobs();
crons.interval('Clean up agent pairing requests',{minutes:15},internal.agentPairing.cleanup,{});
crons.interval('Clean up room-key challenges and limits',{minutes:15},internal.identity.cleanup,{});
crons.interval('Keep the resident bot present and recover pending turns',{minutes:1},internal.bot.tick,{});
crons.interval('Clean up expired sessions and old chat',{hours:1},internal.room.cleanup,{});
export default crons;
