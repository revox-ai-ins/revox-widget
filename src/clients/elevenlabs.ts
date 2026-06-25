import { config } from "../config.js";

export class ElevenLabsClient {
  async createSignedConversationUrl(agentId: string): Promise<string> {
    if (!config.ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is required to create a signed conversation URL");
    }

    const endpoint = new URL(config.ELEVENLABS_SIGNED_URL_ENDPOINT);
    endpoint.searchParams.set("agent_id", agentId);

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "xi-api-key": config.ELEVENLABS_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs signed URL request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { signed_url?: string; signedUrl?: string };
    const signedUrl = payload.signed_url ?? payload.signedUrl;
    if (!signedUrl) {
      throw new Error("ElevenLabs response did not include a signed URL");
    }

    return signedUrl;
  }
}
