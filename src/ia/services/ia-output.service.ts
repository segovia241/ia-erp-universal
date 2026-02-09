import { IAOutputSchema } from "../schemas/ia-output.schema";

export class IAOutputService {
  generate(output: IAOutputSchema | { needsParameters: any[]; message: string; sessionId: string }, context: any) {
    // Si faltan parámetros
    if ('needsParameters' in output) {
      return {
        success: false,
        needsParameters: output.needsParameters,
        message: output.message,
        sessionId: output.sessionId
      };
    }

    // Si es resultado completo
    const { action, module, endpoint, method, payload, preview } = output as IAOutputSchema;

    // Validar permisos
    if (!context.permisos.modulos.includes(module)) {
      return {
        success: false,
        error: "PERMISO_MODULO_DENEGADO"
      };
    }

    if (!context.permisos.acciones.includes(action)) {
      return {
        success: false,
        error: "PERMISO_ACCION_DENEGADO"
      };
    }

    // Generar curl
    const payloadString = payload ? JSON.stringify(payload) : "";
    const curlCommand =
      method === "GET"
        ? `curl "${endpoint}"`
        : `curl -X ${method} -H "Content-Type: application/json" -d '${payloadString}' "${endpoint}"`;

    return {
      success: true,
      preview,
      curl: curlCommand
    };
  }
}
