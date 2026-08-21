type HealthBindings = Pick<CloudflareBindings, "APP_ENV">;

export function createHealthResponse(env: HealthBindings) {
  return Response.json(
    {
      application: "hydraulic-hose-rfq-platform",
      environment: env.APP_ENV,
      status: "ok",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
