import { ERPConfigService } from "../../erp/erp-config.service";
import { interpretLocal } from "./ia-interpreter.local";
import { GeminiService } from "./gemini.service";
import { GeminiInterpreter } from "./ia-interpreter.gemini";
import { DeepSeekService } from "./deepseek/deepseek.service";
import { DeepSeekInterpreter } from "./deepseek/ia-interpreter.deepseek";

export type IAMotor = "GEMINI" | "LOCAL" | "DEEPSEEK";

export interface IIAInterpreter {
  interpret(message: string, modulosDisponibles: string[], erpContext: any): Promise<any>;
}

export class LocalMotor implements IIAInterpreter {
  async interpret(message: string, modulosDisponibles: string[], erpContext: any) {
    return interpretLocal(
      {
        message,
        context: {
          permisos: {
            modulos: modulosDisponibles,
            acciones: [],
          },
          erp: erpContext,
        },
      },
      modulosDisponibles
    );
  }
}

export class GeminiMotor implements IIAInterpreter {
  private gemini: GeminiInterpreter;

  constructor(private erpConfigService: ERPConfigService) {
    this.gemini = new GeminiInterpreter(new GeminiService(), erpConfigService);
  }

  async interpret(message: string, modulosDisponibles: string[], erpContext: any) {
    return this.gemini.interpretWithGemini(message, modulosDisponibles, erpContext);
  }
}

export class DeepSeekMotor implements IIAInterpreter {
  private deepseek: DeepSeekInterpreter;

  constructor(private erpConfigService: ERPConfigService) {
    this.deepseek = new DeepSeekInterpreter(
      new DeepSeekService(),
      erpConfigService
    );
  }

  async interpret(message: string, modulosDisponibles: string[], erpContext: any) {
    return this.deepseek.interpretWithDeepSeek(
      message,
      modulosDisponibles,
      erpContext
    );
  }
}

export function getIAMotor(
  motor: IAMotor,
  erpConfigService: ERPConfigService
): IIAInterpreter {
  if (motor === "GEMINI") return new GeminiMotor(erpConfigService);
  if (motor === "DEEPSEEK") return new DeepSeekMotor(erpConfigService);
  return new LocalMotor();
}
