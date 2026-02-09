import { FastifyInstance } from "fastify";
import { receiveMessage } from "../../ia/services/ia-receiver.service";
import { IAInterpreterService } from "../../ia/services/ia-interpreter.service";
import { IAOutputService } from "../../ia/services/ia-output.service";

export async function iaRoutes(app: FastifyInstance) {
  // Inicializamos los servicios
  const interpreter = new IAInterpreterService("GEMINI");
  const outputService = new IAOutputService();

  app.post("/ia/interpret", async (request, reply) => {
    try {
      // Paso 1: recibir y validar input
      const result = await receiveMessage(request.body);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      // TS ahora sabe que payload existe
      const payload = result.payload!;
      
      // Paso 2: enviar al interprete de IA
      const interpretedOutput = await interpreter.interpret(payload);

      // Paso 3: generar preview y curl respetando permisos
      const finalOutput = outputService.generate({
        output: interpretedOutput,
        context: payload.context
      });

      // Devolver resultado final
      return finalOutput;
    } catch (error) {
      // Manejo de errores genérico
      return reply.status(500).send({
        success: false,
        error: "ERROR_INTERNO",
        details: error instanceof Error ? error.message : error
      });
    }
  });
}
