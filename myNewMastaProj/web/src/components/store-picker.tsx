// /Users/rossamspoker/Documents/Progress/Research/myNewMastaProj/web/src/components/store-picker.tsx

'use client';

import { useState } from 'react';

interface Store {
  locationId: string;
  name: string;
  address: {
    addressLine1: string;
    city: string;
    state: string;
    zipCode: string;
  };
  phone?: string;
}

interface StorePickerProps {
  onSelect: (storeId: string) => void;
}

export default function StorePicker({ onSelect }: StorePickerProps) {
  const [zip, setZip] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zip) return;

    setLoading(true);
    setError('');
    setStores([]);

    try {
      const res = await fetch(`/api/kroger/stores?zipCode=${zip}`);
      if (!res.ok) throw new Error('Failed to fetch stores');
      
      const data = await res.json();
      if (data.data) {
        setStores(data.data);
      } else {
        setError('No stores found in this area.');
      }
    } catch (err) {
      setError('Error searching for stores. Please check the Zip Code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-gray-50 dark:bg-gray-900">
      <h3 className="font-semibold text-lg">Find Your Store</h3>
      
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="Enter Zip Code (e.g. 90210)"
          className="flex-1 p-2 border rounded text-black"
          pattern="[0-9]*"
          maxLength={5}
        />
        <button 
          type="submit" 
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {stores.length > 0 && (
        <ul className="space-y-2 max-h-60 overflow-y-auto">
          {stores.map((store) => (
            <li key={store.locationId}>
              <button
                onClick={() => onSelect(store.locationId)}
                className="w-full text-left p-3 bg-white dark:bg-gray-800 border rounded hover:border-blue-500 transition-colors group"
              >
                <div className="font-medium group-hover:text-blue-500">
                  {store.name} <span className="text-xs text-gray-500">#{store.locationId}</span>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {store.address.addressLine1}, {store.address.city}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
