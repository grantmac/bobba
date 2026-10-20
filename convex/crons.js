import {cronJobs} from 'convex/server';
import {internal} from './_generated/api.js';
const crons=cronJobs();
crons.interval('Clean up expired sessions and old chat',{hours:1},internal.room.cleanup,{});
export default crons;
