import {v} from 'convex/values';
export const seatArg=v.object({x:v.number(),z:v.number(),height:v.number(),offsetX:v.optional(v.number()),offsetY:v.optional(v.number()),offsets:v.optional(v.array(v.object({rotation:v.number(),x:v.number(),y:v.number()})))});
