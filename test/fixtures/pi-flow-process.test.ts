import { spawn, type ChildProcess } from "node:child_process";
import { expect, it, vi } from "vitest";
import {
  piFlowStartup,
  runPiFlowCommand,
  startPiFlowServer,
  terminatePiFlowProcess,
} from "./pi-flow-server";

it.skipIf(process.platform === "win32")(
  "waits through a transient permission-denied liveness probe without hiding signal failures",
  async () => {
    let probes = 0;
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((_pid, signal) => {
        if (signal === 0) {
          const code = probes++ === 0 ? "EPERM" : "ESRCH";
          throw Object.assign(new Error(code), { code });
        }
        return true;
      });
    const child = {
      pid: 123456,
      exitCode: 0,
      signalCode: null,
    } as ChildProcess;
    try {
      await terminatePiFlowProcess(child, 100);
      expect(probes).toBeGreaterThan(1);
      expect(kill).not.toHaveBeenCalledWith(-123456, "SIGKILL");
      kill.mockImplementation(() => {
        throw Object.assign(new Error("TEST signal denied"), { code: "EPERM" });
      });
      await expect(terminatePiFlowProcess(child)).rejects.toThrow(
        "TEST signal denied",
      );
    } finally {
      kill.mockRestore();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "times out an async query process and kills its stubborn process tree without blocking timers",
  async () => {
    const children = new Set<ChildProcess>();
    const command = runPiFlowCommand(
      process.execPath,
      [
        "-e",
        `
      const { spawn } = require('node:child_process');
      process.on('SIGTERM', () => {});
      const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
      console.log(descendant.pid);
      setInterval(() => {}, 1000);
    `,
      ],
      { children, timeoutMs: 500 },
    );
    const child = [...children][0];
    const rejected = expect(command).rejects.toThrow(
      "TEST startup deadline exceeded",
    );
    let timerRan = false;
    const timer = setTimeout(() => {
      timerRan = true;
    }, 10);
    try {
      const descendant = await new Promise<number>((resolve) => {
        child.stdout!.once("data", (data) =>
          resolve(Number(String(data).trim())),
        );
      });
      await rejected;
      expect(timerRan).toBe(true);
      expect(child.signalCode).toBe("SIGKILL");
      expect(() => process.kill(-child.pid!, 0)).toThrow();
      expect(() => process.kill(descendant, 0)).toThrow();
      expect(children.size).toBe(0);
    } finally {
      clearTimeout(timer);
      await terminatePiFlowProcess(child, 30);
    }
  },
  15000,
);

it.skipIf(process.platform === "win32")(
  "kills the isolated launcher and its stubborn descendant before cleanup returns",
  async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
    console.log(descendant.pid);
    setInterval(() => {}, 1000);
  `,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      const descendant = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.stdout.once("data", (data) =>
          resolve(Number(String(data).trim())),
        );
      });
      expect(descendant).toBeGreaterThan(0);
      await terminatePiFlowProcess(child, 30);
      expect(child.signalCode).toBe("SIGKILL");
      expect(() => process.kill(-child.pid!, 0)).toThrow();
      expect(() => process.kill(descendant, 0)).toThrow();
      await terminatePiFlowProcess(child, 30);
    } finally {
      await terminatePiFlowProcess(child as ChildProcess, 30);
    }
  },
  15000,
);

it("registers cleanup before an already-aborted setup can start a Worker", async () => {
  const controller = new AbortController();
  controller.abort(new Error("TEST setup cancelled"));
  let cleanup: (() => Promise<void>) | undefined;
  const starting = startPiFlowServer({
    signal: controller.signal,
    onCleanup: (stop) => {
      cleanup = stop;
    },
  });
  expect(cleanup).toBeTypeOf("function");
  await expect(starting).rejects.toThrow("TEST setup cancelled");
  await cleanup!();
  await cleanup!();
});

it("bounds a hanging initializer and disposes its resource if it resolves after abort", async () => {
  const startup = piFlowStartup(undefined, 20);
  let resolveResource!: (resource: { dispose: () => Promise<void> }) => void;
  let disposed!: () => void;
  const completedDisposal = new Promise<void>((resolve) => {
    disposed = resolve;
  });
  const resource = new Promise<{ dispose: () => Promise<void> }>((resolve) => {
    resolveResource = resolve;
  });
  try {
    await expect(
      startup.wait(resource, (value) => value.dispose()),
    ).rejects.toThrow("TEST startup deadline exceeded");
    resolveResource({
      async dispose() {
        disposed();
      },
    });
    await completedDisposal;
  } finally {
    startup.finish();
  }
});
