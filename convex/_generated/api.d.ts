/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as assets from "../assets.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_appearance from "../lib/appearance.js";
import type * as lib_assets from "../lib/assets.js";
import type * as lib_catalog from "../lib/catalog.js";
import type * as lib_furniture from "../lib/furniture.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_visits from "../lib/visits.js";
import type * as notifications from "../notifications.js";
import type * as pong from "../pong.js";
import type * as room from "../room.js";
import type * as visits from "../visits.js";
import type * as voice from "../voice.js";
import type * as whiteboard from "../whiteboard.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  assets: typeof assets;
  crons: typeof crons;
  http: typeof http;
  "lib/appearance": typeof lib_appearance;
  "lib/assets": typeof lib_assets;
  "lib/catalog": typeof lib_catalog;
  "lib/furniture": typeof lib_furniture;
  "lib/rules": typeof lib_rules;
  "lib/visits": typeof lib_visits;
  notifications: typeof notifications;
  pong: typeof pong;
  room: typeof room;
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
