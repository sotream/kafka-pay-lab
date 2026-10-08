export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const PSP_URL = process.env.NEXT_PUBLIC_PSP_URL ?? 'http://localhost:4100';
export const KAFKA_UI_URL = process.env.NEXT_PUBLIC_KAFKA_UI_URL ?? 'http://localhost:8080';

export interface LoadInput {
  count: number;
  intervalMs: number;
  amount?: number;
}

/** Asks the API to create `count` payments in the background. Throws with the server's message on failure. */
export async function startLoad(input: LoadInput): Promise<number> {
  const response = await fetch(`${API_URL}/api/v1/payments/load`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error([problem.message ?? `HTTP ${response.status}`].flat().join(', '));
  }
  return ((await response.json()) as { accepted: number }).accepted;
}
