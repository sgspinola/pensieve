export function getDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return connectionString;
}

// THROWAWAY (ticket 30 negative test): deliberate type error.
export const ciOkNegativeTest: number = "not a number";
