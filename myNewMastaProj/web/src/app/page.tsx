'use client';
import StorePicker from '@/components/store-picker';
import { useState } from 'react';

type OptimizationResult = any; // You can type this to match the workflow output.

export default function HomePage() {
  const [storeId, setStoreId] = useState('');
  const [iterations, setIterations] = useState(6);
  const [candidates, setCandidates] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const resp = await fetch('/api/optimize-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, iterations, candidatesPerIteration: candidates }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Request failed');
      }

      const data = await resp.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-10">
      <section className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg">
        <h1 className="text-2xl font-semibold mb-4">
          Grocery Inventory Optimizer
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          Enter a Kroger store identifier to run an inventory optimization
          simulation. (Currently uses a sample dataset under the hood.)
        </p>
   
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm mb-1">
              Kroger store ID
            </label>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="e.g. 01100478"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm mb-1">
                Iterations
              </label>
              <input
                type="number"
                min={1}
                max={20}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm mb-1">
                Candidates / iteration
              </label>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={candidates}
                onChange={(e) => setCandidates(Number(e.target.value))}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-emerald-500 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {loading ? 'Running simulation…' : 'Optimize inventory'}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="w-full max-w-2xl mt-8 rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm">
          <h2 className="text-lg font-semibold mb-3">
            Best policy summary
          </h2>
          <pre className="whitespace-pre-wrap break-words text-xs bg-slate-950/70 rounded-md p-3 border border-slate-800">
            {JSON.stringify(result.bestEvaluation, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}