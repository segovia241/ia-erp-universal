import { z } from "zod";

export const IAInputSchema = z.object({
  message: z.string().min(1),

  context: z.object({
    erp: z.string(),
    clienteId: z.string(),
    usuarioId: z.string(),

    permisos: z.object({
      modulos: z.array(z.string()),
      acciones: z.array(z.string())
    })
  })
});

export type IAInput = z.infer<typeof IAInputSchema>;
