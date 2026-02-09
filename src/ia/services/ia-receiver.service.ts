import { IAInputSchema } from "../../types/ia-input.schema";
import { IAInterpreterInput } from "../../types/ia-interpreter-input";

export interface ReceiveMessageResult {
  success: boolean;
  payload?: IAInterpreterInput; // payload ahora usa IAInterpreterInput
  error?: string;
  details?: any;
}

/**
 * Función que recibe un mensaje humano y lo valida
 */
export async function receiveMessage(
  body: unknown
): Promise<ReceiveMessageResult> {
  try {
    const parsed = IAInputSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        error: "INVALID_INPUT",
        details: parsed.error.format()
      };
    }

    const { message, context } = parsed.data;

    // Retornamos payload listo para el interprete
    return {
      success: true,
      payload: { message, context }
    };
  } catch (err) {
    return {
      success: false,
      error: "ERROR_RECEIVER",
      details: err instanceof Error ? err.message : err
    };
  }
}

// Exportar también la interfaz para que otros módulos puedan usarla
export { IAInterpreterInput };
