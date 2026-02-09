import { IAOutputSchema } from "../schemas/ia-output.schema";

interface GenerateOutputParams {
  output: IAOutputSchema;
  context: {
    permisos: {
      modulos: string[];
      acciones: string[];
    };
  };
}

export class IAOutputService {
  /**
   * Genera la preview y el curl respetando permisos
   */
  generate({ output, context }: GenerateOutputParams) {
    const { action, module, endpoint, method, payload, preview } = output;

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

    // Retornar todo
    return {
      success: true,
      preview,
      curl: curlCommand
    };
  }
}
