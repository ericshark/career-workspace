import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { resolveExpected } from "../paths";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const jwks = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json"));
const permission = "chatgpt.tokens.use.direct";
const cache = () => resolveExpected("ui/.cache");
const file = (name: string) => resolveExpected(`ui/.cache/${name}`);
const random = () => randomBytes(32).toString("base64url");
const tokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.number().positive(),
});
type Connection = {
  clientId: string;
  sub: string;
  email?: string;
  idToken?: string;
  access: string;
  refresh?: string;
  expires: number;
  scope: string;
};
type Attempt = {
  state: string;
  nonce: string;
  verifier: string;
  redirect: string;
  expires: number;
  clientId?: string;
  sub?: string;
};

function read<T>(name: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function write(name: string, value: unknown) {
  fs.mkdirSync(cache(), { recursive: true, mode: 0o700 });
  const temp = path.join(cache(), randomUUID() + ".tmp");
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file(name));
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
// One local server owns the rotating refresh credential. Share serialization
// across route bundles so a callback and inference cannot overwrite each other.
const globalState = globalThis as typeof globalThis & {
  careerAuthQueue?: Promise<unknown>;
};
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const next = (globalState.careerAuthQueue ?? Promise.resolve()).then(task);
  globalState.careerAuthQueue = next.catch(() => {});
  return next;
}
const connection = () => read<Connection>("chatgpt-connection.json");
export const openAiMode = () =>
  read<{ mode: "key" | "chatgpt" }>("ai-mode.json")?.mode ?? "key";
export function connectionStatus() {
  const account = connection();
  return {
    mode: openAiMode(),
    openAiKey: Boolean(process.env.OPENAI_API_KEY),
    claudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
    connected: Boolean(account?.scope.split(" ").includes(permission)),
    email: account?.email,
  };
}
export async function setOpenAiMode(mode: "key" | "chatgpt") {
  await withLock(async () => write("ai-mode.json", { mode }));
}
export async function disconnectChatGpt() {
  await withLock(async () => {
    fs.rmSync(file("chatgpt-connection.json"), { force: true });
    fs.rmSync(file("chatgpt-attempt.json"), { force: true });
  });
}
export async function startChatGpt(port: string) {
  return withLock(async () => {
    const host = read<{ id: string }>("chatgpt-host.json") ?? {
      id: `urn:uuid:${randomUUID()}`,
    };
    write("chatgpt-host.json", host);
    const previous = connection();
    const attempt: Attempt = {
      state: random(),
      nonce: random(),
      verifier: random(),
      redirect: `http://127.0.0.1:${port || "80"}/auth/callback`,
      expires: Date.now() + 10 * 60_000,
      clientId: previous?.clientId,
      sub: previous?.sub,
    };
    write("chatgpt-attempt.json", attempt);
    const url = new URL(issuer + "/api/accounts/authorize");
    url.search = new URLSearchParams({
      client_id: previous?.clientId ?? "dynamic_agent_client",
      ...(previous
        ? {
            prompt: "consent",
            ...(previous.idToken ? { id_token_hint: previous.idToken } : {}),
          }
        : { agent_name_hint: "Career Workspace" }),
      ext_agent_host_id: host.id,
      response_type: "code",
      redirect_uri: attempt.redirect,
      scope: `openid profile email offline_access resource.invoke ${permission}`,
      resource,
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256")
        .update(attempt.verifier)
        .digest("base64url"),
    }).toString();
    return url.href;
  });
}
async function exchange(parameters: Record<string, string>) {
  const response = await fetch(issuer + "/api/accounts/oauth/token", {
    method: "POST",
    body: new URLSearchParams({ ...parameters, resource }),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "ChatGPT authorization could not be completed. Reconnect from Models.",
    );
  return tokens.parse(await response.json());
}
export async function finishChatGpt(url: URL) {
  return withLock(async () => {
    const attempt = (() => {
      const pending = read<Attempt>("chatgpt-attempt.json");
      if (
        !pending ||
        pending.expires < Date.now() ||
        pending.state !== url.searchParams.get("state")
      )
        throw new Error("Invalid or expired authorization");
      fs.rmSync(file("chatgpt-attempt.json"));
      return pending;
    })();
    const code = url.searchParams.get("code");
    const clientId = url.searchParams.get("client_id") ?? attempt.clientId;
    if (
      url.searchParams.has("error") ||
      !code ||
      !clientId ||
      clientId === "dynamic_agent_client" ||
      (attempt.clientId && attempt.clientId !== clientId)
    )
      throw new Error("Authorization was declined or incomplete");
    const token = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: attempt.verifier,
      redirect_uri: attempt.redirect,
    });
    if (!token.id_token) throw new Error("Missing identity token");
    const { payload } = await jwtVerify(token.id_token, jwks, {
      issuer,
      audience: clientId,
      requiredClaims: ["exp", "sub", "nonce"],
    });
    if (
      payload.nonce !== attempt.nonce ||
      !payload.sub ||
      (attempt.sub && attempt.sub !== payload.sub)
    )
      throw new Error("Identity verification failed");
    const scope = token.scope ?? "";
    write("chatgpt-connection.json", {
      clientId,
      sub: payload.sub,
      email: payload.email,
      idToken: token.id_token,
      scope,
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + token.expires_in * 1000,
    });
    if (scope.split(" ").includes(permission))
      write("ai-mode.json", { mode: "chatgpt" });
    return scope.split(" ").includes(permission);
  });
}
export async function chatGptToken() {
  const valid = (account: Connection | undefined) =>
    account && account.scope.split(" ").includes(permission);
  const current = connection();
  if (valid(current) && current!.expires > Date.now() + 30_000)
    return current!.access;
  return withLock(async () => {
    const account = connection();
    if (!account || !valid(account))
      throw new Error("Connect an eligible ChatGPT plan from Models first.");
    if (account.expires > Date.now() + 30_000) return account.access;
    if (!account.refresh)
      throw new Error("Reconnect your ChatGPT account from Models.");
    const token = await exchange({
      grant_type: "refresh_token",
      client_id: account.clientId,
      refresh_token: account.refresh,
    });
    const scope = token.scope ?? account.scope;
    write("chatgpt-connection.json", {
      ...account,
      scope,
      access: token.access_token,
      refresh: token.refresh_token ?? account.refresh,
      expires: Date.now() + token.expires_in * 1000,
    });
    if (!scope.split(" ").includes(permission))
      throw new Error(
        "ChatGPT plan permission expired. Reconnect from Models.",
      );
    return token.access_token;
  });
}
