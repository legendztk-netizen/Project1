// Node stand-in for the `cloudflare:workers` runtime module (aliased in
// vitest.config.ts). Real entrypoint behavior is covered in workerd tests.
export class WorkerEntrypoint<Env = unknown> {
  constructor(
    readonly ctx: ExecutionContext,
    readonly env: Env,
  ) {}
}
