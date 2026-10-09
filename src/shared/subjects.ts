import { z } from "zod";

/** Optional inputs for a new subject. A target only makes sense with a source. */
export const subjectInputsSchema = z
  .object({
    source: z.string().trim().default(""),
    target: z.string().trim().default(""),
    question: z.string().trim().default(""),
  })
  .refine(({ source, target }) => !target || !!source, {
    path: ["target"],
    message: "Target requires a source",
  });

/** Branch refs stay qualified for Git, but read as branch names in the viewer. */
export const shortRef = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, "");
