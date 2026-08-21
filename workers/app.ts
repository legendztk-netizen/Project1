import {
  RouterContextProvider,
  createRequestHandler,
} from "react-router";

import { cloudflareContext } from "./context";
import {
  type ApplicationBindings,
  validateRuntimeEnvironment,
} from "./environment";
import { createHealthResponse } from "./health";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  fetch(request, env, ctx) {
    const runtime = validateRuntimeEnvironment(env);
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return createHealthResponse(env);
    }

    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareContext, { env, runtime, ctx });

    return requestHandler(request, routerContext);
  },
} satisfies ExportedHandler<ApplicationBindings>;
