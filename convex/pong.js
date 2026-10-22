// Pong is retired. Keep these inert endpoints while older tabs update: a constant idle
// state stops their game loops without reading players or the old game record. Legacy
// in-flight writes do nothing. New clients never subscribe or call these functions.
import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';

const token=v.string(),side=v.union(v.literal('a'),v.literal('b'));
const ignored=()=>null;
export const state=query({args:{},handler:()=>({status:'idle'})});
export const join=mutation({args:{token},handler:ignored});
export const leave=mutation({args:{token},handler:ignored});
export const paddle=mutation({args:{token,side,y:v.number()},handler:ignored});
export const hit=mutation({args:{token,side,y:v.number(),serial:v.number()},handler:ignored});
export const miss=mutation({args:{token,side,serial:v.number()},handler:ignored});
