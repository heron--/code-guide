import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Agent harnesses the skill can be installed for. All use the Agent Skills format (a folder with SKILL.md). */
export const AGENTS = {
  claude: { label: "Claude Code", user: ".claude/skills", project: ".claude/skills", home: ".claude" },
  pi: { label: "pi", user: ".pi/agent/skills", project: ".pi/skills", home: ".pi" },
  agents: { label: "Agent Skills standard", user: ".agents/skills", project: ".agents/skills", home: ".agents" },
} as const;

export type Agent = keyof typeof AGENTS;

export const isAgent = (s: string): s is Agent => s in AGENTS;

/** Where a harness looks for skills, for the user or for one project. */
export function skillsDir(agent: Agent, projectRoot?: string) {
  const a = AGENTS[agent];
  return projectRoot ? join(projectRoot, a.project) : join(homedir(), a.user);
}

/** Harnesses that appear to be set up on this machine. */
export function detectedAgents(): Agent[] {
  return (Object.keys(AGENTS) as Agent[]).filter((a) => existsSync(join(homedir(), AGENTS[a].home)));
}

/** Ask which harnesses to install for. Only called on an interactive terminal. */
export async function pickAgents(projectRoot?: string): Promise<Agent[]> {
  const { checkbox } = await import("@inquirer/prompts");
  const detected = detectedAgents();
  return checkbox<Agent>({
    message: "Install the code-chapters skill for which agents?",
    required: true,
    choices: (Object.keys(AGENTS) as Agent[]).map((a) => ({
      value: a,
      name: `${AGENTS[a].label.padEnd(22)} ${skillsDir(a, projectRoot).replace(homedir(), "~")}`,
      short: AGENTS[a].label,
      checked: detected.includes(a) && a !== "agents",
    })),
  });
}

export async function installSkill(source: string, skillsDirs: string[]) {
  for (const dir of skillsDirs) {
    const target = join(resolve(dir), "code-chapters");
    await mkdir(dir, { recursive: true });
    await cp(source, target, { recursive: true });
    console.log(`Installed the code-chapters skill to ${target.replace(homedir(), "~")}`);
  }
}
