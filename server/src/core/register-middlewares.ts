import { timing } from "hono/timing";
import { authMiddleware, initContainerMiddleware } from "./hono-middleware";
import type { RinApp } from "./app-types";
import { buildCorsHeaders, isAllowedOrigin } from "../utils/cors";

export function registerMiddlewares(app: RinApp) {
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin") ?? "";
    const allowed = isAllowedOrigin(origin, c.env);

    if (c.req.method === "OPTIONS") {
      if (!allowed) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(origin),
      });
    }

    await next();

    if (allowed) {
      const corsHeaders = buildCorsHeaders(origin);
      for (const [name, value] of Object.entries(corsHeaders)) {
        if (name === "Vary") {
          c.header("Vary", value, { append: true });
        } else {
          c.header(name, value);
        }
      }
    }
  });

  app.use("*", timing({ totalDescription: "" }));
  app.use("*", initContainerMiddleware);
  app.use("*", authMiddleware);
}
