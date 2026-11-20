import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const verify = vi.hoisted(() => vi.fn());
vi.mock("jose", () => ({ createRemoteJWKSet: () => ({}), jwtVerify: verify }));
let root: string;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

it("exchanges with the issued client, checks identity, and enables explicit plan use", async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-chatgpt-"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
  const flow = await import("@/lib/claude/chatgpt-connection");
  const auth = new URL(await flow.startChatGpt("3001"));
  const client = "oaiapp_fixture";
  const callback = new URL(auth.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({
    state: auth.searchParams.get("state")!,
    code: "fixture-code",
    client_id: client,
  }).toString();
  verify.mockResolvedValue({
    payload: { sub: "fixture-user", nonce: auth.searchParams.get("nonce") },
  });
  const fetch = vi.fn(async (_url, options) => {
    expect(options.body.get("client_id")).toBe(client);
    expect(options.body.get("code_verifier")).toBeTruthy();
    return Response.json({
      access_token: "fixture-token",
      id_token: "fixture-identity",
      refresh_token: "fixture-refresh",
      expires_in: 3600,
      scope: "chatgpt.tokens.use.direct",
    });
  });
  vi.stubGlobal("fetch", fetch);
  expect(await flow.finishChatGpt(callback)).toBe(true);
  expect(verify).toHaveBeenCalledWith(
    "fixture-identity",
    expect.anything(),
    expect.objectContaining({
      issuer: "https://auth.openai.com",
      audience: client,
    }),
  );
  expect(flow.connectionStatus()).toMatchObject({
    connected: true,
    mode: "chatgpt",
  });
  expect(JSON.stringify(flow.connectionStatus())).not.toContain(
    "fixture-token",
  );
  expect(await flow.chatGptToken()).toBe("fixture-token");
  await expect(flow.finishChatGpt(callback)).rejects.toThrow(
    /expired authorization/,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  await flow.disconnectChatGpt();
  await expect(flow.chatGptToken()).rejects.toThrow(/Connect an eligible/);
});
