/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as admin from "../admin.js";
import type * as adminCategories from "../adminCategories.js";
import type * as adminCourses from "../adminCourses.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as auth_emailTemplates from "../auth/emailTemplates.js";
import type * as auth_password from "../auth/password.js";
import type * as authGuard from "../authGuard.js";
import type * as billing from "../billing.js";
import type * as catalog from "../catalog.js";
import type * as contact from "../contact.js";
import type * as courses from "../courses.js";
import type * as crons from "../crons.js";
import type * as expiry from "../expiry.js";
import type * as http from "../http.js";
import type * as instructor from "../instructor.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_authGuard from "../lib/authGuard.js";
import type * as lib_pricingConfig from "../lib/pricingConfig.js";
import type * as lib_security from "../lib/security.js";
import type * as notifications from "../notifications.js";
import type * as pricing from "../pricing.js";
import type * as reviews from "../reviews.js";
import type * as seed from "../seed.js";
import type * as storage from "../storage.js";
import type * as users from "../users.js";
import type * as vip from "../vip.js";
import type * as wholesaler from "../wholesaler.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  admin: typeof admin;
  adminCategories: typeof adminCategories;
  adminCourses: typeof adminCourses;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  "auth/emailTemplates": typeof auth_emailTemplates;
  "auth/password": typeof auth_password;
  authGuard: typeof authGuard;
  billing: typeof billing;
  catalog: typeof catalog;
  contact: typeof contact;
  courses: typeof courses;
  crons: typeof crons;
  expiry: typeof expiry;
  http: typeof http;
  instructor: typeof instructor;
  "lib/access": typeof lib_access;
  "lib/authGuard": typeof lib_authGuard;
  "lib/pricingConfig": typeof lib_pricingConfig;
  "lib/security": typeof lib_security;
  notifications: typeof notifications;
  pricing: typeof pricing;
  reviews: typeof reviews;
  seed: typeof seed;
  storage: typeof storage;
  users: typeof users;
  vip: typeof vip;
  wholesaler: typeof wholesaler;
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
