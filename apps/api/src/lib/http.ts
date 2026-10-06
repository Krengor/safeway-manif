import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Valide un payload ; l'erreur renvoyée ne recopie jamais les valeurs reçues. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(racine)'))];
    throw new HttpError(400, 'invalid_payload', `Champs invalides : ${fields.join(', ')}`);
  }
  return result.data;
}

export const epoch = (d: Date): number => Math.floor(d.getTime() / 1000);
