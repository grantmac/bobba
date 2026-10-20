import {defineSchema,defineTable} from 'convex/server';
import {v} from 'convex/values';
const point=v.object({x:v.number(),z:v.number()});
export default defineSchema({
  rooms:defineTable({key:v.string(),options:v.any(),furniture:v.array(v.any()),revision:v.number(),stickies:v.optional(v.array(v.object({id:v.string(),x:v.number(),z:v.number(),side:v.union(v.literal('left'),v.literal('right')),u:v.number(),height:v.number(),text:v.string(),color:v.string(),revision:v.number()})))}).index('by_key',['key']),
  players:defineTable({name:v.string(),nameKey:v.string(),role:v.union(v.literal('guest'),v.literal('admin')),look:v.any(),route:v.array(point),startedAt:v.number(),direction:v.number(),seatId:v.union(v.string(),v.null()),lastSeen:v.number(),lastChat:v.number(),action:v.optional(v.union(v.literal('wave'),v.literal('dance'),v.null())),actionStarted:v.optional(v.number())}).index('by_name',['nameKey']).index('by_seen',['lastSeen']),
  sessions:defineTable({tokenHash:v.string(),playerId:v.id('players'),expiresAt:v.number()}).index('by_token',['tokenHash']).index('by_expiry',['expiresAt']),
  connections:defineTable({playerId:v.id('players'),connectionId:v.string(),tokenHash:v.string(),lastSeen:v.number()}).index('by_connection',['connectionId']).index('by_player',['playerId']),
  messages:defineTable({playerId:v.id('players'),name:v.string(),color:v.string(),body:v.string(),mode:v.union(v.literal('Say'),v.literal('Whisper'),v.literal('Shout')),x:v.number(),z:v.number(),sentAt:v.number()}).index('by_time',['sentAt']),
});
