import { ERPConfigEndpoint } from "../erp/erp-config.service";

export interface IALocalInput {
  message: string;
  context: {
    erp: string;
    baseUrl: string;
    permisos: {
      modulos: string[];
      acciones: string[];
    };
  };
}

// En types.ts (o donde definas IALocalOutput)
export interface IALocalOutput {
  module: string;
  action: "CREATE" | "READ" | "UPDATE" | "DELETE";
  endpoint: string;
  payload: any;
  preview: any;
  method: "GET" | "POST" | "PUT" | "DELETE";
  endpointConfig: ERPConfigEndpoint;
  confidence?: number; // Añade esta línea
}