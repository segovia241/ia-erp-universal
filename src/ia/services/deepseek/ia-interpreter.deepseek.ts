import { ERPConfigService } from "../../../erp/erp-config.service";
import { DeepSeekService } from "./deepseek.service";

export class DeepSeekInterpreter {
  constructor(
    private deepseekService: DeepSeekService,
    private erpConfigService: ERPConfigService
  ) {}

  async interpretWithDeepSeek(
    message: string,
    modulosDisponibles: string[],
    erpContext: any
  ) {
    const systemPrompt = `
Eres un asistente inteligente dentro de un ERP.
Solo puedes responder usando los módulos disponibles.
Devuelve siempre un JSON estructurado.
`;

    const userPrompt = `
Mensaje del usuario:
${message}

Módulos disponibles:
${JSON.stringify(modulosDisponibles)}

Contexto ERP:
${JSON.stringify(erpContext)}
`;

    const response = await this.deepseekService.createChatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    try {
      return JSON.parse(response || "{}");
    } catch {
      return { raw: response };
    }
  }
}
