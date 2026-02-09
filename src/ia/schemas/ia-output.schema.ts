export interface IAOutputSchema {
  action: "CREATE" | "READ" | "UPDATE" | "DELETE" | string;

  module: string;

  endpoint: string;

  method: "GET" | "POST" | "PUT" | "DELETE" | string;

  payload: Record<string, any> | null;

  preview: Record<string, any>;
}
