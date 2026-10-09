import chat from "./chat/module.js";
import diff from "./diff/module.js";
import guide from "./guide/module.js";
import overview from "./overview/module.js";
import quiz from "./quiz/module.js";
import trace from "./trace/module.js";
import type { Module } from "./types.js";

/** Every module, in the order the "+" menu lists them. Adding one is one line here. */
export const modules: Module[] = [overview, guide, quiz, trace, diff, chat];
