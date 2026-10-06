import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createDb(url: string): Sql {
  return postgres(url, {
    // Pool par instance : le pooling global passe par PgBouncer en production (§53).
    max: 10,
    idle_timeout: 30,
    connect_timeout: 5,
    // Requêtes courtes obligatoires (§53) : 3 s maximum.
    connection: { statement_timeout: 3000, application_name: 'safeway-api' },
    onnotice: () => {},
  });
}
