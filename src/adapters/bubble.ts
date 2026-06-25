import { config } from "../config.js";
import { AnalyticsEvent, BubbleWidgetRecord } from "../types.js";

const mockWidgets = new Map<string, BubbleWidgetRecord>([
  [
    "demo-widget",
    {
      public_widget_id: "demo-widget",
      elevenlabs_agent_id: "demo-elevenlabs-agent",
      widget_name: "Revox Assistant",
      logo_url: "",
      primary_color: "#2563eb",
      secondary_color: "#0f172a",
      background_color: "#ffffff",
      text_color: "#111827",
      welcome_message: "Hi, I am the Revox assistant. Start a chat and I will help from here.",
      widget_position: "bottom-right",
      is_widget_active: true,
      allowed_domains: ["localhost", "127.0.0.1"],
      text_enabled: true,
      voice_enabled: false
    }
  ]
]);

type BubbleWorkflowResponse = {
  response?: BubbleWidgetRecord;
} & Partial<BubbleWidgetRecord>;

export class BubbleAdapter {
  async getWidgetByPublicId(widgetId: string): Promise<BubbleWidgetRecord | null> {
    if (!config.BUBBLE_WORKFLOW_URL) {
      return mockWidgets.get(widgetId) ?? null;
    }

    const response = await fetch(config.BUBBLE_WORKFLOW_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.BUBBLE_API_TOKEN ? { authorization: `Bearer ${config.BUBBLE_API_TOKEN}` } : {})
      },
      body: JSON.stringify({ public_widget_id: widgetId })
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Bubble widget config request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as BubbleWorkflowResponse;
    const record = payload.response ?? payload;
    if (!record || Object.keys(record).length === 0) return null;

    return normalizeBubbleRecord(record, widgetId);
  }

  async logAnalyticsEvent(input: {
    event: AnalyticsEvent;
    widgetId: string;
    sessionId?: string;
    origin?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!config.BUBBLE_ANALYTICS_URL) return;

    const response = await fetch(config.BUBBLE_ANALYTICS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.BUBBLE_API_TOKEN ? { authorization: `Bearer ${config.BUBBLE_API_TOKEN}` } : {})
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      throw new Error(`Bubble analytics request failed with status ${response.status}`);
    }
  }
}

function normalizeBubbleRecord(record: Partial<BubbleWidgetRecord>, fallbackWidgetId: string): BubbleWidgetRecord {
  if (!record.elevenlabs_agent_id) {
    throw new Error("Bubble widget response is missing required private fields");
  }

  return {
    public_widget_id: record.public_widget_id ?? fallbackWidgetId,
    elevenlabs_agent_id: record.elevenlabs_agent_id,
    widget_name: record.widget_name ?? "Revox Assistant",
    logo_url: record.logo_url ?? "",
    primary_color: record.primary_color ?? "#2563eb",
    secondary_color: record.secondary_color ?? "#0f172a",
    background_color: record.background_color ?? "#ffffff",
    text_color: record.text_color ?? "#111827",
    welcome_message: record.welcome_message ?? "Hi, how can I help?",
    widget_position: record.widget_position === "bottom-left" ? "bottom-left" : "bottom-right",
    is_widget_active: record.is_widget_active !== false,
    allowed_domains: Array.isArray(record.allowed_domains) ? record.allowed_domains : [],
    text_enabled: record.text_enabled !== false,
    voice_enabled: Boolean(record.voice_enabled)
  };
}
