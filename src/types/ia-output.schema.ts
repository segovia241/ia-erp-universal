import { z } from "zod";

/*
  ============================
  ENUMS BASE
  ============================
*/

export const HttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
]);

export const ExecutionModeSchema = z.enum([
  "PREVIEW",     // No persiste datos
  "COMMIT"       // Persiste datos en ERP
]);

export const StepActionTypeSchema = z.enum([
  "HTTP_REQUEST",      // Llamada a ERP
  "TRANSFORM",         // Transformación de datos
  "FILTER",            // Filtrado
  "MAP",               // Mapeo de estructura
  "AGGREGATE",         // Agregaciones (sumas, totales)
  "SELECT_FIELDS"      // Selección de campos solicitados por usuario
]);

export const PreviewTypeSchema = z.enum([
  "TABLE",
  "DOCUMENT",
  "CUSTOM"
]);

/*
  ============================
  STEP INPUT / OUTPUT
  ============================
*/

export const DynamicValueSchema = z.object({
  fromStep: z.string(),
  path: z.string()
});

export const ValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.any()),
  z.array(z.any()),
  DynamicValueSchema
]);

/*
  ============================
  STEP DEFINITION
  ============================
*/

export const StepSchema = z.object({
  id: z.string(),

  type: StepActionTypeSchema,

  description: z.string().optional(),

  dependsOn: z.array(z.string()).optional(),

  request: z.object({
    method: HttpMethodSchema,
    endpoint: z.string(),

    query: z.record(ValueSchema).optional(),
    headers: z.record(ValueSchema).optional(),
    body: z.record(ValueSchema).optional()
  }).optional(),

  transform: z.object({
    inputPath: z.string(),
    outputPath: z.string(),
    strategy: z.enum([
      "FLATTEN",
      "NEST",
      "MERGE",
      "CUSTOM"
    ])
  }).optional(),

  filter: z.object({
    inputPath: z.string(),
    conditions: z.array(
      z.object({
        field: z.string(),
        operator: z.enum(["=", "!=", ">", "<", ">=", "<=", "IN", "EXISTS"]),
        value: ValueSchema.optional()
      })
    )
  }).optional(),

  selectFields: z.object({
    inputPath: z.string(),
    fields: z.array(z.string()),
    allowPartial: z.boolean().default(true)
  }).optional()
});

/*
  ============================
  PREVIEW DEFINITION
  ============================
*/

export const PreviewSchema = z.object({
  enabled: z.boolean(),

  type: PreviewTypeSchema,

  sourceStepId: z.string(),

  fieldsRequested: z.array(z.string()),

  resolvedFields: z.array(z.string()).optional(),

  missingFields: z.array(z.string()).optional(),

  layoutHint: z.object({
    title: z.string().optional(),
    groupBy: z.array(z.string()).optional(),
    totals: z.array(z.string()).optional()
  }).optional()
});

/*
  ============================
  FINAL IA OUTPUT
  ============================
*/

export const IAOutputSchema = z.object({
  meta: z.object({
    erp: z.string(),
    module: z.string(),
    version: z.string().optional()
  }),

  intent: z.object({
    domain: z.enum([
      "FACTURACION",
      "VENTAS",
      "COMPRAS",
      "INVENTARIO",
      "CONTABILIDAD",
      "GENERIC"
    ]),
    action: z.string()
  }),

  executionMode: ExecutionModeSchema,

  steps: z.array(StepSchema).min(1),

  preview: PreviewSchema.optional(),

  warnings: z.array(z.string()).optional(),

  confidence: z.number().min(0).max(1).optional()
});

/*
  ============================
  TYPES EXPORT
  ============================
*/

export type IAOutput = z.infer<typeof IAOutputSchema>;
