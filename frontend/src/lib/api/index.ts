/**
 * Typed client for the HabitQuest backend, one module per area. Import from "lib/api" (this file); the
 * modules are: types (shared types), client (the request helper), accounts, plans, kid, rewards,
 * family-extras and ai (one function per endpoint).
 */
export * from "./types";
export * from "./client";
export * from "./accounts";
export * from "./plans";
export * from "./kid";
export * from "./rewards";
export * from "./family-extras";
export * from "./ai";
