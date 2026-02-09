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
      
      // Extraer sessionId si existe
      const sessionId = payload.sessionId;
      
      // Paso 2: enviar al interprete de IA (con sessionId si hay)
      const interpretedOutput = await interpreter.interpret(
        { message: payload.message, context: payload.context },
        sessionId
      );

      // Paso 3: generar preview y curl respetando permisos
      const finalOutput = outputService.generate(
        interpretedOutput,
        payload.context
      );

      // Devolver resultado final
      return reply.send(finalOutput);
    } catch (error: any) {
      // Manejo de errores genérico
      console.error("Error en interpretación:", error);
      return reply.status(500).send({
        success: false,
        error: "ERROR_INTERNO",
        details: error.message || "Error interno del servidor"
      });
    }
  });

  // Endpoint adicional para debug
  app.get("/ia/debug", async (request, reply) => {
    try {
      const debugInfo = interpreter.debugInfo();
      return reply.send({
        success: true,
        ...debugInfo
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });
}
