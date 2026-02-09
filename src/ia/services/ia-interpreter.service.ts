import { IAInterpreterInput } from "./ia-receiver.service";
import { IAOutputSchema } from "../schemas/ia-output.schema";
import { GeminiService } from "./gemini.service";
import { ERPConfigService } from "../../erp/erp-config.service";
import { interpretLocal, localService } from "./ia-interpreter.local";
import { GeminiInterpreter } from "./ia-interpreter.gemini";

type IAMotor = "GEMINI" | "LOCAL";

export class IAInterpreterService {
  private motor: IAMotor;
  private gemini?: GeminiInterpreter;
  private erpConfigService: ERPConfigService;

  constructor(motor: IAMotor = "GEMINI") {
    this.motor = motor;
    this.erpConfigService = new ERPConfigService();

    console.log(`🔧 Motor configurado: ${motor}`);

    if (motor === "GEMINI") {
      this.gemini = new GeminiInterpreter(new GeminiService(), this.erpConfigService);
      console.log(`🔧 Servicio Gemini inicializado`);
    }
  }

  async interpret(input: IAInterpreterInput): Promise<IAOutputSchema> {
    const { message, context } = input;
    const modulosDisponibles = context.permisos.modulos;

    let localResult: any;
    let localError: any;

    try {
      console.log(`🔄 Intentando motor local primero...`);
      localResult = await interpretLocal(input, modulosDisponibles);

      const confidence = localResult.confidence || 0;
      const UMBRAL_CONFIANZA = 0.15;

      if (confidence >= UMBRAL_CONFIANZA) {
        return {
          action: localResult.action,
          module: localResult.module,
          endpoint: localResult.endpoint,
          method: localResult.method,
          payload: localResult.payload,
          preview: localResult.preview
        };
      } else {
        localError = new Error(`Confianza insuficiente: ${confidence.toFixed(2)}`);
      }
    } catch (err: any) {
      localError = err;
    }

    if (this.motor === "GEMINI" && this.gemini) {
      try {
        return await this.gemini.interpretWithGemini(message, modulosDisponibles, context.erp);
      } catch (geminiError: any) {
        if (localResult) return localResult;
        throw new Error(`No se pudo interpretar la instrucción. Motor local: ${localError?.message}, Gemini: ${geminiError.message}`);
      }
    }

    if (localResult) return localResult;
    throw new Error(`Motor local falló: ${localError?.message}`);
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
      localService: "Configurado"
    };
  }
}
