import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { BubbleAdapter } from "../adapters/bubble.js";
import { ElevenLabsClient } from "../clients/elevenlabs.js";
import { AnalyticsEvent } from "../types.js";
import { isOriginAllowedForWidget, isPageHostAllowedForWidget, originFromRequest, toPublicWidgetConfig } from "../security.js";

const widgetIdParamSchema = z.object({
  widgetId: z.string().trim().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/)
});

const widgetSessionSchema = z.object({
  widgetId: z.string().trim().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  pageUrl: z.string().url().max(2048)
});

const analyticsSchema = z.object({
  widgetId: z.string().trim().min(3).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  sessionId: z.string().trim().max(120).optional(),
  event: z.enum(["loaded", "opened", "chat_started", "message_sent", "chat_ended"]),
  metadata: z.record(z.unknown()).optional()
});

export async function registerPublicRoutes(
  app: FastifyInstance,
  bubble: BubbleAdapter,
  elevenLabs: ElevenLabsClient
) {
  app.get("/public/widget-config/:widgetId", async (request, reply) => {
    const { widgetId } = widgetIdParamSchema.parse(request.params);
    const widget = await bubble.getWidgetByPublicId(widgetId);

    if (!widget || !widget.is_widget_active || !widget.text_enabled) {
      return reply.code(404).send({ error: "Widget not found" });
    }

    return reply.send(toPublicWidgetConfig(widget));
  });

  app.post("/public/widget-session", async (request, reply) => {
    const body = widgetSessionSchema.parse(request.body);
    const widget = await bubble.getWidgetByPublicId(body.widgetId);
    const origin = originFromRequest(request);

    if (!widget || !widget.is_widget_active || !widget.text_enabled) {
      return reply.code(404).send({ error: "Widget not found" });
    }

    if (!isPageHostAllowedForWidget(body.pageUrl, widget)) {
      request.log.warn(
        { widgetId: body.widgetId, origin, pageUrl: body.pageUrl },
        "Blocked widget session request from disallowed page URL"
      );
      return reply.code(403).send({ error: "Page URL is not allowed for this widget" });
    }

    const sessionId = randomUUID();
    let signedUrl: string;

    try {
      signedUrl = await elevenLabs.createSignedConversationUrl(widget.elevenlabs_agent_id);
    } catch (error) {
      request.log.error({ error, widgetId: body.widgetId }, "Failed to create ElevenLabs signed URL");
      return reply.code(502).send({ error: "Unable to start chat session" });
    }

    await logAnalytics(app, bubble, {
      event: "chat_started",
      widgetId: widget.public_widget_id,
      sessionId,
      origin
    });

    return reply.send({
      signedUrl,
      agentName: widget.widget_name,
      welcomeMessage: widget.welcome_message
    });
  });

  app.post("/public/widget-analytics", async (request, reply) => {
    const body = analyticsSchema.parse(request.body);
    const widget = await bubble.getWidgetByPublicId(body.widgetId);
    const origin = originFromRequest(request);

    if (!widget || !widget.is_widget_active) {
      return reply.code(404).send({ error: "Widget not found" });
    }

    if (!isOriginAllowedForWidget(origin, widget)) {
      request.log.warn({ widgetId: body.widgetId, origin }, "Blocked analytics request from disallowed origin");
      return reply.code(403).send({ error: "Origin is not allowed for this widget" });
    }

    await logAnalytics(app, bubble, {
      event: body.event,
      widgetId: body.widgetId,
      sessionId: body.sessionId,
      origin,
      metadata: body.metadata
    });

    return reply.code(202).send({ ok: true });
  });
}

async function logAnalytics(
  app: FastifyInstance,
  bubble: BubbleAdapter,
  input: {
    event: AnalyticsEvent;
    widgetId: string;
    sessionId?: string;
    origin?: string;
    metadata?: Record<string, unknown>;
  }
) {
  app.log.info(input, "Widget analytics event");
  try {
    await bubble.logAnalyticsEvent(input);
  } catch (error) {
    app.log.warn({ error, ...input }, "Failed to send analytics event to Bubble");
  }
}
