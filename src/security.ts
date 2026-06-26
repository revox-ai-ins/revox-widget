import { FastifyRequest } from "fastify";
import { BubbleWidgetRecord } from "./types.js";
import { globalAllowedOrigins } from "./config.js";

export function originFromRequest(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;
  if (origin) return origin;

  const referer = request.headers.referer;
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {
      return undefined;
    }
  }

  const host = request.headers.host;
  if (host) {
    return `http://${host}`;
  }
}

export function hostnameFromOrigin(origin?: string): string | undefined {
  if (!origin) return undefined;

  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function hostnameFromPageUrl(pageUrl?: string): string | undefined {
  if (!pageUrl) return undefined;

  try {
    return new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isOriginAllowedForWidget(origin: string | undefined, widget: BubbleWidgetRecord): boolean {
  if (!origin) return false;
  if (globalAllowedOrigins.includes(origin)) return true;

  const hostname = hostnameFromOrigin(origin);
  if (!hostname) return false;

  if (!hasConfiguredAllowedDomains(widget)) return true;

  return widget.allowed_domains.some((domain) => {
    const normalized = normalizeAllowedDomain(domain);

    if (!normalized) return false;
    if (normalized.startsWith("*.")) {
      const base = normalized.slice(2);
      return hostname === base || hostname.endsWith(`.${base}`);
    }

    return hostname === normalized;
  });
}

export function isPageHostAllowedForWidget(pageUrl: string | undefined, widget: BubbleWidgetRecord): boolean {
  if (!pageUrl) return false;

  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return false;
  }

  if (globalAllowedOrigins.includes(origin)) return true;

  const hostname = hostnameFromPageUrl(pageUrl);
  if (!hostname) return false;

  if (!hasConfiguredAllowedDomains(widget)) return true;

  return widget.allowed_domains.some((domain) => {
    const normalized = normalizeAllowedDomain(domain);

    if (!normalized) return false;
    if (normalized.startsWith("*.")) {
      const base = normalized.slice(2);
      return hostname === base || hostname.endsWith(`.${base}`);
    }

    return hostname === normalized;
  });
}

function hasConfiguredAllowedDomains(widget: BubbleWidgetRecord): boolean {
  return widget.allowed_domains.some((domain) => Boolean(normalizeAllowedDomain(domain)));
}

function normalizeAllowedDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .trim();
}

export function toPublicWidgetConfig(widget: BubbleWidgetRecord) {
  return {
    widget_name: widget.widget_name,
    logo_url: widget.logo_url,
    primary_color: widget.primary_color,
    secondary_color: widget.secondary_color,
    background_color: widget.background_color,
    text_color: widget.text_color,
    welcome_message: widget.welcome_message,
    widget_position: widget.widget_position,
    text_enabled: widget.text_enabled,
    voice_enabled: widget.voice_enabled
  };
}
