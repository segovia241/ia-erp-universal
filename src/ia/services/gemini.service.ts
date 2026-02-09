import { GoogleGenAI } from "@google/genai";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY no configurada en el .env");
    }

    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  /**
   * Llama a Gemini y devuelve el texto generado, con debug completo
   */
  async generateContent(prompt: string): Promise<string> {
    console.log("=== GEMINI PROMPT ===");
    console.log(prompt);
    console.log("===================");

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      let text = response.text ?? "";

      // Depuración: log de la respuesta cruda
      console.log("=== GEMINI RAW RESPONSE ===");
      console.log(text);
      console.log("===========================");

      // Limpiar posibles backticks o ```json
      text = text.trim();
      if (text.startsWith("```") && text.endsWith("```")) {
        text = text.replace(/```(json)?/g, "").trim();
      }

      console.log("=== GEMINI CLEANED RESPONSE ===");
      console.log(text);
      console.log("==============================");

      return text;
    } catch (err: any) {
      console.error("Error llamando a Gemini:", err);
      throw new Error(
        `Error en Gemini: ${err.message} | status: ${err.status ?? "desconocido"}`
      );
    }
  }
}
