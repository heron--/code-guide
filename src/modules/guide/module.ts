import { defineModule } from "../types.js";
import { instructions, prompt } from "./instructions.js";
import { submitGuide } from "./submit.js";

export default defineModule({
  name: "guide",
  label: "Guide",
  icon: ["M3 3h7l3 3v7H3z", "M5.5 7h5M5.5 9.5h5M5.5 12h3"],
  startsWithSession: true,
  job: { kind: "guide", instructions, prompt: (ctx) => prompt(ctx.subject), submit: submitGuide },
});
