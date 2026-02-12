import { FastifyInstance } from "fastify";
import { DeepSeekRawService } from "../../ia/services/deepseek/deepseek-raw.service";

export async function iaRoutes(app: FastifyInstance) {
  const deepseekService = new DeepSeekRawService();

  app.post("/ia/interpret", async (request, reply) => {
    try {
      // Tomamos el mensaje directamente del body
      const message = (request.body as any)?.message;
      if (!message || typeof message !== "string") {
        return reply.status(400).send({
          success: false,
          error: "INVALID_MESSAGE",
          details: "El body debe tener un campo 'message' de tipo string"
        });
      }

      // Enviamos el mensaje crudo a DeepSeek
      const deepseekOutput = await deepseekService.sendAndMapToSchema(message);

      // Devolvemos la respuesta tal cual la devuelve DeepSeek
      return reply.send({
        success: true,
        output: deepseekOutput
      });
    } catch (error: any) {
      console.error("Error enviando mensaje a DeepSeek:", error);
      return reply.status(500).send({
        success: false,
        error: "ERROR_INTERNO",
        details: error.message || "Error interno del servidor"
      });
    }
  });

  // Endpoint de debug
  app.get("/ia/debug", async (request, reply) => {
    return reply.send({
      success: true,
      info: "Endpoint funcionando. Mensajes se envían directamente a DeepSeek."
    });
  });
}
