import Fastify from "fastify";
import dotenv from "dotenv";
import { iaRoutes } from "./routes/ia.routes";

dotenv.config();

const server = Fastify({
  logger: true
});

const PORT = Number(process.env.PORT) || 8085;

server.register(iaRoutes, {
  prefix: "/api/v1"
});

const start = async () => {
  try {
    await server.listen({
      port: PORT,
      host: "0.0.0.0"
    });

    console.log("-- server running on port " + PORT + " --");
  } catch (err) {
    console.log("-- server failed to start --");
    console.log(err);
    process.exit(1);
  }
};

start();
