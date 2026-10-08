import spawn from "cross-spawn";

/**
 * Run a program and return its stdout. Through cross-spawn, so Windows' `.cmd` shims (npm-installed CLIs)
 * work like any other executable. Rejects with stderr when it exits non-zero.
 */
export function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      ...(opts.env && { env: { ...process.env, ...opts.env } }),
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out).toString("utf8"))
        : reject(new Error(Buffer.concat(err).toString("utf8").trim() || `${cmd} exited with ${code}`)),
    );
  });
}
