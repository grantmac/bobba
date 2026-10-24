/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentPairing from "../agentPairing.js";
import type * as agents from "../agents.js";
import type * as assetControls from "../assetControls.js";
import type * as assets from "../assets.js";
import type * as bot from "../bot.js";
import type * as botBrain from "../botBrain.js";
import type * as botVoice from "../botVoice.js";
import type * as captures from "../captures.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as lib_appearance from "../lib/appearance.js";
import type * as lib_assetControls from "../lib/assetControls.js";
import type * as lib_assets from "../lib/assets.js";
import type * as lib_bot_events from "../lib/bot_events.js";
import type * as lib_bot_policy from "../lib/bot_policy.js";
import type * as lib_catalog from "../lib/catalog.js";
import type * as lib_furniture from "../lib/furniture.js";
import type * as lib_furnitureStore from "../lib/furnitureStore.js";
import type * as lib_identity from "../lib/identity.js";
import type * as lib_programs from "../lib/programs.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_seat from "../lib/seat.js";
import type * as lib_spaceLayout from "../lib/spaceLayout.js";
import type * as lib_visits from "../lib/visits.js";
import type * as migrate from "../migrate.js";
import type * as notifications from "../notifications.js";
import type * as passkeys from "../passkeys.js";
import type * as pong from "../pong.js";
import type * as programs from "../programs.js";
import type * as room from "../room.js";
import type * as spriteBackfill from "../spriteBackfill.js";
import type * as spriteMaintenance from "../spriteMaintenance.js";
import type * as surfaceBackfill from "../surfaceBackfill.js";
import type * as surfaceMaintenance from "../surfaceMaintenance.js";
import type * as thumbnailBackfill from "../thumbnailBackfill.js";
import type * as thumbnailMaintenance from "../thumbnailMaintenance.js";
import type * as visits from "../visits.js";
import type * as voice from "../voice.js";
import type * as whiteboard from "../whiteboard.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentPairing: typeof agentPairing;
  agents: typeof agents;
  assetControls: typeof assetControls;
  assets: typeof assets;
  bot: typeof bot;
  botBrain: typeof botBrain;
  botVoice: typeof botVoice;
  captures: typeof captures;
  crons: typeof crons;
  http: typeof http;
  identity: typeof identity;
  "lib/appearance": typeof lib_appearance;
  "lib/assetControls": typeof lib_assetControls;
  "lib/assets": typeof lib_assets;
  "lib/bot_events": typeof lib_bot_events;
  "lib/bot_policy": typeof lib_bot_policy;
  "lib/catalog": typeof lib_catalog;
  "lib/furniture": typeof lib_furniture;
  "lib/furnitureStore": typeof lib_furnitureStore;
  "lib/identity": typeof lib_identity;
  "lib/programs": typeof lib_programs;
  "lib/rules": typeof lib_rules;
  "lib/seat": typeof lib_seat;
  "lib/spaceLayout": typeof lib_spaceLayout;
  "lib/visits": typeof lib_visits;
  migrate: typeof migrate;
  notifications: typeof notifications;
  passkeys: typeof passkeys;
  pong: typeof pong;
  programs: typeof programs;
  room: typeof room;
  spriteBackfill: typeof spriteBackfill;
  spriteMaintenance: typeof spriteMaintenance;
  surfaceBackfill: typeof surfaceBackfill;
  surfaceMaintenance: typeof surfaceMaintenance;
  thumbnailBackfill: typeof thumbnailBackfill;
  thumbnailMaintenance: typeof thumbnailMaintenance;
  visits: typeof visits;
  voice: typeof voice;
  whiteboard: typeof whiteboard;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
