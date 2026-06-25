export type WidgetPosition = "bottom-right" | "bottom-left";

export type BubbleWidgetRecord = {
  public_widget_id: string;
  elevenlabs_agent_id: string;
  widget_name: string;
  logo_url?: string;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  text_color: string;
  welcome_message: string;
  widget_position: WidgetPosition;
  is_widget_active: boolean;
  allowed_domains: string[];
  text_enabled: boolean;
  voice_enabled: boolean;
};

export type PublicWidgetConfig = {
  widgetId: string;
  widgetName: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  welcomeMessage: string;
  widgetPosition: WidgetPosition;
  textEnabled: boolean;
  voiceEnabled: boolean;
};

export type AnalyticsEvent =
  | "loaded"
  | "opened"
  | "chat_started"
  | "message_sent"
  | "chat_ended";
