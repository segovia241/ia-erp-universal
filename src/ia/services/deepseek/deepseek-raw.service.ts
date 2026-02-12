import axios from "axios";
import { IAOutputSchema } from "../../schemas/ia-output.schema";

export class DeepSeekRawService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  // Plantilla de instrucciones para DeepSeek
  private readonly systemPrompt = `
Eres un asistente inteligente dentro de un ERP.
Siempre debes devolver la respuesta estrictamente en JSON.
La estructura del JSON debe ser:
{
  "mensaje": "<mensaje natural que explica la acción>",
  "endpoint": "<endpoint seleccionado>",
  "payload": { /* datos necesarios para el endpoint */ },
  "method": "<POST|GET|PUT|DELETE>"
}
No agregues explicaciones ni bloques de código fuera del JSON.
`;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || "";
    this.baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1/chat/completions";
  }

  async sendRawMessage(message: string): Promise<any> {
    const response = await axios.post(
      this.baseUrl,
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: this.systemPrompt
          },
          {
            role: "user",
            content: message
          }
        ],
        temperature: 0
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        }
      }
    );

    return response.data;
  }

  async sendAndMapToSchema(message: string): Promise<IAOutputSchema> {
    const raw = await this.sendRawMessage(message);

    const content = raw?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Respuesta inválida de DeepSeek");
    }

    let parsed;

    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("DeepSeek no devolvió un JSON válido");
    }

    return parsed as IAOutputSchema;
  }
}
