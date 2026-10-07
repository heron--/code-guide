import chat from "./chat/module.js";
import diff from "./diff/module.js";
import guide from "./guide/module.js";
import type { Module } from "./types.js";

/** Every module, in the order the "+" menu lists them. Adding one is one line here. */
export const modules: Module[] = [guide, diff, chat];
