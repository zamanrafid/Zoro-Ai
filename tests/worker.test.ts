import { describe, it, expect } from "vitest";
import { buildWorkerRequest, getWorkerBase } from "../lib/worker";
import { listProviders } from "../lib/providers";

describe("own-model worker contract", () => {
  it("shapes a strict request for your server", () => {
    const r = buildWorkerRequest({
      kind: "clip",
      prompt: "a cat detective",
      width: 5000,
      height: 10,
      durationSec: 99,
      seed: 7
    });
    expect(r.kind).toBe("clip");
    expect(r.width).toBe(2048);
    expect(r.height).toBe(64);
    expect(r.durationSec).toBe(30);
    expect(r.seed).toBe(7);
  });

  it("rejects bad WORKER_URL values (never phones arbitrary hosts)", () => {
    delete process.env.WORKER_URL;
    expect(getWorkerBase()).toBeNull();
    process.env.WORKER_URL = "not-a-url";
    expect(getWorkerBase()).toBeNull();
    process.env.WORKER_URL = "http://127.0.0.1:8188/";
    expect(getWorkerBase()).toBe("http://127.0.0.1:8188");
    delete process.env.WORKER_URL;
  });

  it("lists the worker as unconfigured until WORKER_URL is set, leaking no URL", () => {
    delete process.env.WORKER_URL;
    const w = listProviders().find((p) => p.id === "worker")!;
    expect(w.configured).toBe(false);
    expect(w.missing).toMatch(/WORKER_URL/);
    expect(JSON.stringify(w)).not.toContain("127.0.0.1");
  });
});
