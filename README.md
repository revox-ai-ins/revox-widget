# Revox Embeddable AI Chat Widget

First MVP for a customer-installed Revox widget:

```html
<script
  src="https://widget.revoxai.io/embed.js"
  data-widget-id="PUBLIC_WIDGET_ID">
</script>
```

This release is text chat only. Voice, Twilio streaming, live monitoring, transfers, and supervisor tools are intentionally out of scope.

## What Is Included

- Vanilla JavaScript `public/embed.js` widget with Shadow DOM isolation.
- Dynamic Bubble-driven theme: logo, colors, welcome message, and widget position.
- Text chat UI with launcher, open/close, message history, loading state, disconnect/error state, mobile layout, and Powered by Revox footer.
- TypeScript Fastify API for safe public config, signed session creation, and analytics.
- Bubble adapter for server-to-server backend workflow calls.
- ElevenLabs signed URL generation on the backend only.
- Rate limiting, CORS support, origin/domain validation, Zod input validation, structured logs, Docker setup, `.env.example`, and local demo page.

## Local Demo

```bash
cd revox-widget
cp .env.example .env
npm install
npm run dev
```

In development, open [http://localhost:8080/demo.html](http://localhost:8080/demo.html).

In development, open [http://localhost:8080/demo-real.html](http://localhost:8080/demo-real.html) to load `data-widget-id="revox_demo_001"` through Bubble.

Demo pages live in `examples/` and are not served when `NODE_ENV=production`.

When `BUBBLE_WORKFLOW_URL` is blank, the API uses mock widget config for `demo-widget`. `ELEVENLABS_API_KEY` is required for real chat sessions.

## API

### `GET /public/widget-config/:widgetId`

Returns only safe display fields:

```json
{
  "widget_name": "Revox Assistant",
  "logo_url": "",
  "primary_color": "#2563eb",
  "secondary_color": "#0f172a",
  "background_color": "#ffffff",
  "text_color": "#111827",
  "welcome_message": "Hi, I am the Revox assistant.",
  "widget_position": "bottom-right",
  "text_enabled": true,
  "voice_enabled": false
}
```

The response does not include `elevenlabs_agent_id`, Bubble private fields, API keys, admin credentials, or allowed domains.

### `POST /public/widget-session`

Request:

```json
{
  "widgetId": "PUBLIC_WIDGET_ID",
  "pageUrl": "https://customer-site.example/pricing"
}
```

Response:

```json
{
  "signedUrl": "wss://...",
  "agentName": "Revox Agent",
  "welcomeMessage": "Hi, how can I help?"
}
```

The backend validates widget status, `text_enabled`, and `pageUrl` hostname against Bubble `allowed_domains`, then requests an ElevenLabs signed URL server-side using `ELEVENLABS_API_KEY`.

### `POST /public/widget-analytics`

Accepted events:

- `loaded`
- `opened`
- `chat_started`
- `message_sent`
- `chat_ended`

The API logs events with Pino and forwards them to Bubble when `BUBBLE_ANALYTICS_URL` is configured.

## Bubble Integration

`src/adapters/bubble.ts` calls Bubble backend workflows server-to-server. It does not call Bubble Data API from `embed.js`.

Expected config workflow behavior:

- URL comes from `BUBBLE_WORKFLOW_URL`.
- Method: `POST`.
- Auth: `Authorization: Bearer BUBBLE_API_TOKEN`.
- Body: `{ "public_widget_id": "PUBLIC_WIDGET_ID" }`.
- Response may be either the widget record directly or `{ "response": { ...record } }`.

The Bubble workflow should return these fields to the Revox backend:

- `public_widget_id`
- `elevenlabs_agent_id`
- `widget_name`
- `logo_url`
- `primary_color`
- `secondary_color`
- `background_color`
- `text_color`
- `welcome_message`
- `widget_position`
- `is_widget_active`
- `allowed_domains`
- `text_enabled`
- `voice_enabled`

Only safe display fields are forwarded to the browser.

Expected analytics workflow behavior:

- URL comes from optional `BUBBLE_ANALYTICS_URL`.
- Method: `POST`.
- Body includes `event`, `widgetId`, optional `sessionId`, optional `origin`, and optional `metadata`.

## Environment

See `.env.example`.

Important production settings:

- `ELEVENLABS_API_KEY`: required for real sessions.
- `BUBBLE_WORKFLOW_URL`: required for Bubble-backed widget records.
- `BUBBLE_API_TOKEN`: required for admin-only Bubble backend workflows.
- `GLOBAL_ALLOWED_ORIGINS`: keep narrow. Widget-specific domains are enforced from Bubble `allowed_domains`.
- `HOST`: use `127.0.0.1` locally and `0.0.0.0` in Docker or most hosting platforms.

## Docker

```bash
cd revox-widget
cp .env.example .env
docker compose up --build
```

The service listens on port `8080` by default and serves `embed.js` from the same origin as the API.

## Production Embed

Serve this service at `https://widget.revoxai.io`, then customers install:

```html
<script
  src="https://widget.revoxai.io/embed.js"
  data-widget-id="PUBLIC_WIDGET_ID">
</script>
```

For staging or local development, the script can override the API base:

```html
<script
  src="http://localhost:8080/embed.js"
  data-api-base="http://localhost:8080"
  data-widget-id="demo-widget">
</script>
```
