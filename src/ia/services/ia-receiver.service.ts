import { IAInputSchema } from "../../types/ia-input.schema";
import { IAInterpreterInput } from "../../types/ia-interpreter-input";

export interface ReceiveMessageResult {
  success: boolean;
  payload?: IAInterpreterInput & { sessionId?: string };
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
    // Parsear el cuerpo de la solicitud
    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
    
    // Validar estructura básica
    if (!parsedBody || typeof parsedBody !== 'object') {
      return {
        success: false,
        error: "INVALID_INPUT",
        details: "El cuerpo de la solicitud debe ser un objeto JSON válido"
      };
    }

    const { message, context, sessionId } = parsedBody;

    // Validar campos requeridos
    if (!message || typeof message !== 'string') {
      return {
        success: false,
        error: "INVALID_MESSAGE",
        details: "El campo 'message' es requerido y debe ser una cadena de texto"
      };
    }

    if (!context || typeof context !== 'object') {
      return {
        success: false,
        error: "INVALID_CONTEXT",
        details: "El campo 'context' es requerido y debe ser un objeto"
      };
    }

    // Validar permisos dentro del contexto
    if (!context.permisos || !Array.isArray(context.permisos.modulos) || !Array.isArray(context.permisos.acciones)) {
      return {
        success: false,
        error: "INVALID_PERMISSIONS",
        details: "El contexto debe contener permisos con modulos y acciones como arrays"
      };
    }

    // Validar sessionId si está presente
    if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId.startsWith('sess_'))) {
      return {
        success: false,
        error: "INVALID_SESSION_ID",
        details: "sessionId debe ser una cadena que comience con 'sess_'"
      };
    }

    // Retornar payload listo para el interprete
    return {
      success: true,
      payload: { 
        message, 
        context,
        sessionId: sessionId || undefined
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: "ERROR_RECEIVER",
      details: err.message || "Error desconocido al procesar la solicitud"
    };
  }
}

// Exportar también la interfaz para que otros módulos puedan usarla
export { IAInterpreterInput };
