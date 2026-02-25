// web/app/api/optimize-inventory/route.ts
import { NextRequest, NextResponse } from 'next/server';

const MASTRA_URL =
  process.env.MASTRA_URL || 'http://localhost:4111';

export async function POST(req: NextRequest) {
  const { storeId, iterations = 6, candidatesPerIteration = 3 } = await req.json();

  // For now we ignore storeId and use your synthetic preset.
  // Later: switch to a kroger-inventory-optimization-workflow that takes storeId.
  const resp = await fetch(
    `${MASTRA_URL}/mastra/workflows/inventory-optimization-workflow/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: {
          preset: 'richmond-va-small',
          iterations,
          candidatesPerIteration,
        },
      }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    return NextResponse.json(
      { error: 'Mastra workflow failed', details: text },
      { status: 500 },
    );
  }

  const data = await resp.json();
  return NextResponse.json(data);
}