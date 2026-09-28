import { MongoClient, type Db } from 'mongodb';

// Thin wrapper so callers (index.ts) don't need to know MongoClient's own
// API surface -- just "give me a connected Db". Uses whatever database name
// is in the connection string (or the driver's own default) rather than
// hardcoding one, so a single Atlas cluster can host multiple environments
// via different connection strings without code changes.
export async function connectMongo(uri: string): Promise<Db> {
  const client = new MongoClient(uri);
  await client.connect();
  return client.db();
}
