import { IALocalInput, createIALocalService } from "../../ia-local";
import { IAInterpreterInput } from "./ia-receiver.service";

export const localService = createIALocalService();

export async function interpretLocal(input: IAInterpreterInput, modulosDisponibles: string[]) {
  const { message, context } = input;

  const localInput: IALocalInput = {
    message,
    context: {
      erp: context.erp,
      baseUrl: context.baseUrl || "http://localhost:8000",
      permisos: context.permisos
    }
  };

  const result = await localService.interpret(localInput);

  if (!modulosDisponibles.includes(result.module)) {
    throw new Error(`Módulo no permitido: ${result.module}`);
  }

  return result;
}
