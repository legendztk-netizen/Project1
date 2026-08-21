import {
  RouterContextProvider,
  createRequestHandler,
} from "react-router";

import { cloudflareContext } from "./context";
import { createHealthResponse } from "./health";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return createHealthResponse(env);
    }

    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareContext, { env, ctx });

    return requestHandler(request, routerContext);
  },
} satisfies ExportedHandler<CloudflareBindings>;
