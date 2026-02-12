import { ERPConfigService, ERPConfigEndpoint } from "../../../erp/erp-config.service";
import { DeepSeekService } from "./deepseek.service";
import { IAOutputSchema } from "../../schemas/ia-output.schema";

export class DeepSeekInterpreter {
  constructor(
    private deepseekService: DeepSeekService,
    private erpConfigService: ERPConfigService
  ) {}

  async interpretWithDeepSeek(
    message: string,
    modulosDisponibles: string[],
    erp: string
  ): Promise<IAOutputSchema> {

    const promptModuleCrud = `Eres un asistente ERP. Solo devuelve módulo y acción CRUD.
Módulos disponibles: ${modulosDisponibles.join(", ")}.
Mensaje del usuario: "${message}".
Devuelve estrictamente un JSON: {"module":"<uno de los módulos disponibles>","crud":"<CREATE|READ|UPDATE|DELETE>","confidence":<0-1>}.
No agregues explicaciones ni bloques de código.`;

    const aiRaw = await this.deepseekService.createChatCompletion([
      { role: "system", content: "Eres un asistente ERP estructurado." },
      { role: "user", content: promptModuleCrud }
    ]);

    const aiResponse = (aiRaw || "").replace(/```(json)?/g, "").trim();

    let moduleDetected: string;
    let crudDetected: "CREATE" | "READ" | "UPDATE" | "DELETE";
    let confidence = 0.8;

    try {
      const parsed = JSON.parse(aiResponse);
      moduleDetected = parsed.module.toUpperCase();
      crudDetected = parsed.crud.toUpperCase() as "CREATE" | "READ" | "UPDATE" | "DELETE";
      confidence = parsed.confidence ?? 0.8;

      if (!modulosDisponibles.includes(moduleDetected)) {
        throw new Error(`Módulo no permitido: ${moduleDetected}`);
      }
    } catch (err: any) {
      throw new Error(`Error parseando respuesta módulo/CRUD DeepSeek: ${aiResponse}. ${err.message}`);
    }

    const endpoints: ERPConfigEndpoint[] =
      this.erpConfigService.getEndpoints(erp, moduleDetected, crudDetected);

    if (!endpoints || endpoints.length === 0) {
      throw new Error(`No hay endpoints para ${moduleDetected} / ${crudDetected}`);
    }

    if (endpoints.length === 1) {
      const chosenEndpoint = endpoints[0];
      return {
        action: crudDetected,
        module: moduleDetected,
        endpoint: chosenEndpoint.endpoint,
        method: chosenEndpoint.metodo as "GET" | "POST" | "PUT" | "DELETE",
        payload: chosenEndpoint.payload || {},
        preview: chosenEndpoint.tipo_salida === "preview" ? (chosenEndpoint.payload || {}) : {},
        confidence
      };
    }

    const promptEndpoint = `Eres un asistente ERP. Tienes estos endpoints disponibles para módulo ${moduleDetected} y acción ${crudDetected}:
${JSON.stringify(endpoints.map(ep => ({
  intencion: ep.intencion,
  descripcion: ep.descripcion,
  endpoint: ep.endpoint,
  payload_requerido: ep.payload
})), null, 2)}
Mensaje del usuario: "${message}"
Elige el endpoint más adecuado y completa el payload según la instrucción.
Devuelve estrictamente un JSON: {"endpoint":"<endpoint seleccionado>","payload":{...},"confidence":<0-1>}.
No agregues explicaciones ni comentarios.`;

    const endpointRaw = await this.deepseekService.createChatCompletion([
      { role: "system", content: "Eres un asistente ERP estructurado." },
      { role: "user", content: promptEndpoint }
    ]);

    const endpointResponse = (endpointRaw || "").replace(/```(json)?/g, "").trim();

    let chosenEndpoint: ERPConfigEndpoint;
    let payloadFinal: any;

    try {
      const parsed = JSON.parse(endpointResponse);
      chosenEndpoint =
        endpoints.find(e => e.endpoint === parsed.endpoint) ?? endpoints[0];
      payloadFinal = parsed.payload ?? chosenEndpoint.payload ?? {};
      confidence = parsed.confidence ?? confidence;
    } catch {
      chosenEndpoint = endpoints[0];
      payloadFinal = chosenEndpoint.payload || {};
    }

    return {
      action: crudDetected,
      module: moduleDetected,
      endpoint: chosenEndpoint.endpoint,
      method: chosenEndpoint.metodo as "GET" | "POST" | "PUT" | "DELETE",
      payload: payloadFinal,
      preview: chosenEndpoint.tipo_salida === "preview" ? payloadFinal : {},
      confidence
    };
  }
}
