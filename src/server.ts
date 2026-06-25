import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { BubbleAdapter } from "./adapters/bubble.js";
import { ElevenLabsClient } from "./clients/elevenlabs.js";
import { config, globalAllowedOrigins } from "./config.js";
import { registerPublicRoutes } from "./routes/public.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const examplesDir = path.resolve(__dirname, "../examples");

const app = fastify({
  logger: {
    level: config.NODE_ENV === "development" ? "debug" : "info"
  }
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: "Invalid request", details: error.flatten() });
  }

  request.log.error({ error }, "Unhandled API error");
  return reply.code(500).send({ error: "Internal server error" });
});

await app.register(helmet, {
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
});

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || globalAllowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    // Per-widget authorization still happens inside the route handlers.
    callback(null, true);
  },
  methods: ["GET", "POST", "OPTIONS"]
});

await app.register(rateLimit, {
  max: config.RATE_LIMIT_MAX,
  timeWindow: config.RATE_LIMIT_WINDOW
});

if (config.NODE_ENV !== "production") {
  const demoPages = new Set(["demo.html", "demo-a123.html", "demo-real.html"]);
  app.get("/:demoPage", async (request, reply) => {
    const { demoPage } = request.params as { demoPage: string };
    if (!demoPages.has(demoPage)) return reply.callNotFound();

    const html = await readFile(path.join(examplesDir, demoPage), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });
}

await app.register(fastifyStatic, {
  root: publicDir,
  prefix: "/"
});

await registerPublicRoutes(app, new BubbleAdapter(), new ElevenLabsClient());

app.get("/health", async () => ({ ok: true }));

await app.listen({ port: config.PORT, host: config.HOST });
