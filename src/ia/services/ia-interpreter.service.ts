import { IAInterpreterInput } from "./ia-receiver.service";
import { IAOutputSchema } from "../schemas/ia-output.schema";
import { GeminiService } from "./gemini.service";
import { ERPConfigService } from "../../erp/erp-config.service";
import { interpretLocal, localService } from "./ia-interpreter.local";
import { GeminiInterpreter } from "./ia-interpreter.gemini";

type IAMotor = "GEMINI" | "LOCAL";

interface PendingRequest {
  originalResult: any;
  missingParams: Array<{param: string; type: string; description: string}>;
  context: any;
  timestamp: number;
}

export class IAInterpreterService {
  private motor: IAMotor;
  private gemini?: GeminiInterpreter;
  private erpConfigService: ERPConfigService;
  private pendingSessions: Map<string, PendingRequest> = new Map();
  private readonly SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutos

  constructor(motor: IAMotor = "GEMINI") {
    this.motor = motor;
    this.erpConfigService = new ERPConfigService();

    console.log(`🔧 Motor configurado: ${motor}`);

    if (motor === "GEMINI") {
      this.gemini = new GeminiInterpreter(new GeminiService(), this.erpConfigService);
      console.log(`🔧 Servicio Gemini inicializado`);
    }

    // Limpiar sesiones expiradas periódicamente
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
  }

  async interpret(input: IAInterpreterInput, sessionId?: string): Promise<IAOutputSchema | { needsParameters: any[]; message: string; sessionId: string }> {
    const { message, context } = input;
    const modulosDisponibles = context.permisos.modulos;

    // Si hay una sesión pendiente, procesar como continuación
    if (sessionId && this.pendingSessions.has(sessionId)) {
      const pendingRequest = this.pendingSessions.get(sessionId)!;
      const result = await this.processFollowUp(message, pendingRequest, sessionId);
      
      // Si el resultado tiene sessionId, ya está incluido
      if ('sessionId' in result) {
        return result;
      }
      
      // Si no, agregar el sessionId
      return { ...result, sessionId };
    }

    let localResult: any;
    let localError: any;

    try {
      localResult = await interpretLocal(input, modulosDisponibles);

      const confidence = localResult.confidence || 0;
      const UMBRAL_CONFIANZA = 0.15;

      if (confidence >= UMBRAL_CONFIANZA) {
        const missingParams = this.checkMissingParameters(localResult);
        
        if (missingParams.length > 0) {
          // Guardar sesión pendiente
          const newSessionId = sessionId || this.generateSessionId();
          this.pendingSessions.set(newSessionId, {
            originalResult: localResult,
            missingParams: missingParams,
            context: context,
            timestamp: Date.now()
          });
          
          return {
            needsParameters: missingParams,
            message: this.generateParameterRequestMessage(missingParams, localResult),
            sessionId: newSessionId
          };
        }
        
        return localResult;
      } else {
        localError = new Error(`Confianza insuficiente: ${confidence.toFixed(2)}`);
      }
    } catch (err: any) {
      localError = err;
    }

    if (this.motor === "GEMINI" && this.gemini) {
      try {
        const geminiResult = await this.gemini.interpretWithGemini(message, modulosDisponibles, context.erp);
        const missingParams = this.checkMissingParameters(geminiResult);
        
        if (missingParams.length > 0) {
          const newSessionId = sessionId || this.generateSessionId();
          this.pendingSessions.set(newSessionId, {
            originalResult: geminiResult,
            missingParams: missingParams,
            context: context,
            timestamp: Date.now()
          });
          
          return {
            needsParameters: missingParams,
            message: this.generateParameterRequestMessage(missingParams, geminiResult),
            sessionId: newSessionId
          };
        }
        
        return geminiResult;
      } catch (geminiError: any) {
        if (localResult) return localResult;
        throw new Error(`No se pudo interpretar la instrucción. Motor local: ${localError?.message}, Gemini: ${geminiError.message}`);
      }
    }

    if (localResult) return localResult;
    throw new Error(`Motor local falló: ${localError?.message}`);
  }

  private async processFollowUp(
    message: string, 
    pendingRequest: PendingRequest, 
    sessionId: string
  ): Promise<IAOutputSchema | { needsParameters: any[]; message: string }> {
    
    const { originalResult, missingParams } = pendingRequest;
    
    // Extraer parámetros del mensaje de seguimiento
    const extractedParams = this.extractParametersFromMessage(message, missingParams);
    
    // Actualizar payload con nuevos parámetros
    const updatedResult = this.updatePayload(originalResult, extractedParams);
    
    // Verificar si aún faltan parámetros
    const remainingMissingParams = this.checkMissingParameters(updatedResult);
    
    if (remainingMissingParams.length > 0) {
      // Actualizar sesión con los parámetros que aún faltan
      this.pendingSessions.set(sessionId, {
        originalResult: updatedResult,
        missingParams: remainingMissingParams,
        context: pendingRequest.context,
        timestamp: Date.now()
      });
      
      return {
        needsParameters: remainingMissingParams,
        message: this.generateParameterRequestMessage(remainingMissingParams, updatedResult)
      };
    } else {
      // Todos los parámetros están completos - eliminar sesión
      this.pendingSessions.delete(sessionId);
      return updatedResult;
    }
  }

  private checkMissingParameters(result: any): Array<{param: string; type: string; description: string}> {
    const missingParams: Array<{param: string; type: string; description: string}> = [];
    
    if (!result.payload) return missingParams;
    
    Object.entries(result.payload).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "" || value === "?") {
        missingParams.push({
          param: key,
          type: this.guessParameterType(key),
          description: this.getParameterDescription(key)
        });
      }
    });
    
    return missingParams;
  }

  private guessParameterType(paramName: string): string {
    const paramNameLower = paramName.toLowerCase();
    
    if (paramNameLower.includes('id')) return 'ID';
    if (paramNameLower.includes('fecha') || paramNameLower.includes('date')) return 'FECHA';
    if (paramNameLower.includes('cliente') || paramNameLower.includes('customer')) return 'CLIENTE';
    if (paramNameLower.includes('cantidad') || paramNameLower.includes('quantity')) return 'NÚMERO';
    if (paramNameLower.includes('monto') || paramNameLower.includes('amount') || paramNameLower.includes('total')) return 'MONTO';
    
    return 'TEXTO';
  }

  private getParameterDescription(paramName: string): string {
    const paramNameLower = paramName.toLowerCase();
    
    if (paramNameLower.includes('id')) return 'el identificador único';
    if (paramNameLower.includes('fecha') || paramNameLower.includes('date')) return 'la fecha (YYYY-MM-DD)';
    if (paramNameLower.includes('cliente')) return 'el nombre o código del cliente';
    if (paramNameLower.includes('cantidad')) return 'la cantidad';
    if (paramNameLower.includes('monto')) return 'el monto';
    
    return paramName;
  }

  private generateParameterRequestMessage(missingParams: any[], result: any): string {
    if (missingParams.length === 1) {
      const param = missingParams[0];
      return `Para ${result.action.toLowerCase()} ${result.module.toLowerCase()}, necesito ${param.description}.`;
    } else {
      const paramList = missingParams.map(p => p.description).join(', ');
      return `Para ${result.action.toLowerCase()} ${result.module.toLowerCase()}, necesito: ${paramList}.`;
    }
  }

  private extractParametersFromMessage(message: string, missingParams: any[]): Record<string, string> {
    const extracted: Record<string, string> = {};
    
    missingParams.forEach(param => {
      // Buscar el parámetro en el texto
      const value = this.findParameterValue(message, param.param, param.type);
      if (value) {
        extracted[param.param] = value;
      }
    });
    
    return extracted;
  }

  private findParameterValue(text: string, paramName: string, type: string): string | null {
    const textLower = text.toLowerCase();
    const paramNameLower = paramName.toLowerCase();
    
    // Patrones comunes
    const patterns = [
      `${paramNameLower}\\s+(es|de|:|es\\s+de)\\s+([^\\s.,;]+(?:\\s+[^\\s.,;]+)*)`,
      `con\\s+${paramNameLower}\\s+([^\\s.,;]+(?:\\s+[^\\s.,;]+)*)`,
      `para\\s+${paramNameLower}\\s+([^\\s.,;]+(?:\\s+[^\\s.,;]+)*)`,
      `${paramNameLower}\\s+([^\\s.,;]+)`,
      `([^\\s.,;]+)\\s+${paramNameLower}`
    ];
    
    for (const pattern of patterns) {
      const regex = new RegExp(pattern, 'i');
      const match = text.match(regex);
      if (match && match[2]) {
        return match[2].trim();
      } else if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  private updatePayload(result: any, newParams: Record<string, string>): any {
    const updatedResult = { ...result };
    
    if (!updatedResult.payload) {
      updatedResult.payload = {};
    }
    
    Object.entries(newParams).forEach(([key, value]) => {
      if (value) {
        updatedResult.payload[key] = value;
      }
    });
    
    return updatedResult;
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.pendingSessions.entries()) {
      if (now - session.timestamp > this.SESSION_TIMEOUT) {
        this.pendingSessions.delete(sessionId);
      }
    }
  }

  setMotor(motor: IAMotor): void {
    this.motor = motor;
    if (motor === "GEMINI" && !this.gemini) {
      this.gemini = new GeminiInterpreter(new GeminiService(), this.erpConfigService);
    } else if (motor === "LOCAL") {
      this.gemini = undefined;
    }
  }

  debugInfo(): any {
    return {
      motor: this.motor,
      geminiDisponible: !!this.gemini,
      erpConfig: "Cargado",
      localService: "Configurado",
      activeSessions: this.pendingSessions.size
    };
  }
}
