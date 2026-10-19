import { z } from "zod";

/**
 * Settings, from `~/.code-guide/settings.json`, overridden key by key by the repository's
 * `.code-guide/settings.json`. Command-line flags override both. Every key is optional.
 */
export const settingsSchema = z
  .object({
    /** Agent harness, by the name `--harness` takes. */
    harness: z.string().min(1),
    /** Model for jobs and chat. */
    model: z.string().min(1),
    /** Model for reviews; defaults to `model`. */
    reviewModel: z.string().min(1),
    /** Modules open when a session starts, left slot first; a third and later wait in the dock. */
    modules: z.array(z.string().min(1)),
    theme: z.enum(["light", "dark", "system"]),
    port: z.number().int().min(0).max(65535),
    /** Open the browser when a session starts. */
    open: z.boolean(),
    /** Retain temporary PR checkouts after their session process stops; defaults to false. */
    keepClones: z.boolean(),
  })
  .partial()
  .strict();

export type Settings = z.infer<typeof settingsSchema>;

/** What the browser needs, sent in the channel's welcome. */
export type ViewSettings = { modules: string[]; theme: "light" | "dark" | "system" };

export const DEFAULT_VIEW: ViewSettings = { modules: ["guide", "chat"], theme: "system" };
