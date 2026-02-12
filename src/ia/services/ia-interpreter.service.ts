import { IAInterpreterInput } from "./ia-receiver.service";
import { IAOutputSchema } from "../schemas/ia-output.schema";
import { ERPConfigService } from "../../erp/erp-config.service";
import { IAMotor, IIAInterpreter, getIAMotor } from "./ia-motor-factory";

interface PendingRequest {
  originalResult: any;
  missingParams: Array<{param: string; type: string; description: string}>;
  context: any;
  timestamp: number;
}

type InterpretResult = IAOutputSchema | { needsParameters: any[]; message: string; sessionId: string };

export class IAInterpreterService {
  private motor: IAMotor;
  private interpreter: IIAInterpreter;
  private erpConfigService: ERPConfigService;
  private pendingSessions: Map<string, PendingRequest> = new Map();
  private readonly SESSION_TIMEOUT = 15 * 60 * 1000;

  constructor(motor: IAMotor = "LOCAL") {
    this.motor = motor;
    this.erpConfigService = new ERPConfigService();
    this.interpreter = getIAMotor(motor, this.erpConfigService);

    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
  }

  async interpret(input: IAInterpreterInput, sessionId?: string): Promise<InterpretResult> {
  const { message, context } = input;
  const modulosDisponibles = context.permisos.modulos;

  // Usar sessionId del input si existe
  const activeSessionId = sessionId || input.sessionId;

  // Si hay una sesión pendiente, procesar como continuación
  if (activeSessionId && this.pendingSessions.has(activeSessionId)) {
    const pendingRequest = this.pendingSessions.get(activeSessionId)!;
    const result = await this.processFollowUp(message, pendingRequest, activeSessionId);

    // Diferenciar tipos explícitamente
    if ('needsParameters' in result) {
      return {
        needsParameters: result.needsParameters,
        message: result.message,
        sessionId: activeSessionId
      };
    }

    // Si es IAOutputSchema
    return result as IAOutputSchema;
  }

  let result: any;
  try {
    result = await this.interpreter.interpret(message, modulosDisponibles, context.erp);

    const confidence = result.confidence || 0;
    const UMBRAL_CONFIANZA = 0.15;

    if (confidence >= UMBRAL_CONFIANZA) {
      const missingParams = this.checkMissingParameters(result);
      if (missingParams.length > 0) {
        const newSessionId = activeSessionId || this.generateSessionId();
        this.pendingSessions.set(newSessionId, {
          originalResult: result,
          missingParams,
          context,
          timestamp: Date.now()
        });
        return {
          needsParameters: missingParams,
          message: this.generateParameterRequestMessage(missingParams, result),
          sessionId: newSessionId
        };
      }
      return result as IAOutputSchema;
    }

    throw new Error(`Confianza insuficiente: ${confidence.toFixed(2)}`);
  } catch (error: any) {
    throw new Error(`Error al interpretar: ${error.message}`);
  }
}

  setMotor(motor: IAMotor): void {
    this.motor = motor;
    this.interpreter = getIAMotor(motor, this.erpConfigService);
  }

  // --- Funciones auxiliares idénticas al original ---
  private async processFollowUp(
    message: string, 
    pendingRequest: PendingRequest, 
    sessionId: string
  ): Promise<IAOutputSchema | { needsParameters: any[]; message: string }> {
    const { originalResult, missingParams } = pendingRequest;
    const extractedParams = this.extractParametersFromMessage(message, missingParams);
    const updatedResult = this.updatePayload(originalResult, extractedParams);
    const remainingMissingParams = this.checkMissingParameters(updatedResult);

    if (remainingMissingParams.length > 0) {
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
      this.pendingSessions.delete(sessionId);
      return updatedResult as IAOutputSchema;
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
      const value = this.findParameterValue(message, param.param, param.type);
      if (value) extracted[param.param] = value;
    });
    return extracted;
  }

  private findParameterValue(text: string, paramName: string, type: string): string | null {
    const textLower = text.toLowerCase();
    const paramNameLower = paramName.toLowerCase();
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
      if (match && match[2]) return match[2].trim();
      if (match && match[1]) return match[1].trim();
    }
    return null;
  }

  private updatePayload(result: any, newParams: Record<string, string>): any {
    const updatedResult = { ...result };
    if (!updatedResult.payload) updatedResult.payload = {};
    Object.entries(newParams).forEach(([key, value]) => {
      if (value) updatedResult.payload[key] = value;
    });
    return updatedResult;
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.pendingSessions.entries()) {
      if (now - session.timestamp > this.SESSION_TIMEOUT) this.pendingSessions.delete(sessionId);
    }
  }
}