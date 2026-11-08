/**
 * Secrets come only from the macOS keychain (or env for CI/tests).
 * Values are never logged.
 */
export async function keychain(account: string, service: string): Promise<string | null> {
  const proc = Bun.spawn(["security", "find-generic-password", "-a", account, "-s", service, "-w"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  return (await proc.exited) === 0 && out ? out : null;
}

export async function yuqueToken(): Promise<string> {
  const t = process.env.YUQUE_TOKEN || (await keychain("yuque", "YUQUE_TOKEN"));
  if (!t) throw new Error("缺少语雀 Token：security add-generic-password -a yuque -s YUQUE_TOKEN -w");
  return t;
}

export async function adminCredentials(): Promise<{ username: string; password: string }> {
  const username = process.env.ADMIN_USERNAME || (await keychain("rin", "RIN_ADMIN_USERNAME"));
  const password = process.env.ADMIN_PASSWORD || (await keychain("rin", "RIN_ADMIN_PASSWORD"));
  if (!username || !password) throw new Error("缺少博客管理员凭据：钥匙串 RIN_ADMIN_USERNAME / RIN_ADMIN_PASSWORD");
  return { username, password };
}
