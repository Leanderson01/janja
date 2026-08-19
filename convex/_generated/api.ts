/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import { anyApi } from "convex/server";
import type * as channelReadState from "../channelReadState.js";
import type * as channels from "../channels.js";
import type * as dms from "../dms.js";
import type * as friends from "../friends.js";
import type * as invites from "../invites.js";
import type * as lib_inviteCode from "../lib/inviteCode.js";
import type * as lib_membership from "../lib/membership.js";
import type * as lib_tag from "../lib/tag.js";
import type * as members from "../members.js";
import type * as messages from "../messages.js";
import type * as presence from "../presence.js";
import type * as servers from "../servers.js";
import type * as typing from "../typing.js";
import type * as users from "../users.js";
import type * as voice from "../voice.js";
import type * as voiceToken from "../voiceToken.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
const fullApi: ApiFromModules<{
  channelReadState: typeof channelReadState;
  channels: typeof channels;
  dms: typeof dms;
  friends: typeof friends;
  invites: typeof invites;
  "lib/inviteCode": typeof lib_inviteCode;
  "lib/membership": typeof lib_membership;
  "lib/tag": typeof lib_tag;
  members: typeof members;
  messages: typeof messages;
  presence: typeof presence;
  servers: typeof servers;
  typing: typeof typing;
  users: typeof users;
  voice: typeof voice;
  voiceToken: typeof voiceToken;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<typeof fullApi, FunctionReference<any, "public">> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">> = anyApi as any;
