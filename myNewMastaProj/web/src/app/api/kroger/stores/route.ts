// /Users/rossamspoker/Documents/Progress/Research/myNewMastaProj/web/src/app/api/kroger/stores/route.ts

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const zipCode = searchParams.get('zipCode');

  if (!zipCode) {
    return NextResponse.json({ error: 'Zip code is required' }, { status: 400 });
  }

  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Missing Kroger Credentials in .env.local');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    // 1. Get Access Token (Client Credentials Flow)
    const tokenResponse = await fetch('https://api.kroger.com/v1/connect/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials&scope=product.compact',
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('Kroger Auth Failed:', err);
      throw new Error('Failed to authenticate with Kroger');
    }

    const { access_token } = await tokenResponse.json();

    // 2. Search Locations by Zip Code
    const locationsResponse = await fetch(
      `https://api.kroger.com/v1/locations?filter.zipCode.near=${zipCode}&filter.limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!locationsResponse.ok) {
      throw new Error('Failed to fetch locations');
    }

    const data = await locationsResponse.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Kroger API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch stores' }, { status: 500 });
  }
}

