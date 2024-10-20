import { Region } from '@medusajs/medusa';
import { notFound } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:9000';
const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "us";

const regionMapCache = {
  regionMap: new Map<string, Region>(),
  regionMapUpdated: Date.now(),
};

async function getRegionMap() {
  const { regionMap, regionMapUpdated } = regionMapCache;

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    try {
      // Fetch regions from Medusa
      const response = await fetch(`${BACKEND_URL}/store/regions`, {
        next: {
          revalidate: 3600,
          tags: ["regions"],
        },
      });

      // Log da resposta completa
      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      // Verifica se a resposta é bem-sucedida
      if (!response.ok) {
        console.error(`Error fetching regions: ${response.status} - ${response.statusText}`);
        throw new Error(`Failed to fetch regions: ${response.statusText}`);
      }

      // Verifica se o conteúdo da resposta é JSON
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await response.text();  // Registra o texto completo da resposta
        console.error('Non-JSON response body:', textResponse);
        throw new Error('Received non-JSON response');
      }

      // Tenta converter a resposta para JSON
      const data = await response.json();

      // Verifica se os dados retornados possuem a chave 'regions'
      const { regions } = data;
      if (!regions) {
        notFound();
      }

      // Cria um mapa de códigos de países para regiões
      regions.forEach((region: Region) => {
        region.countries.forEach((c) => {
          regionMapCache.regionMap.set(c.iso_2, region);
        });
      });

      regionMapCache.regionMapUpdated = Date.now();
    } catch (error) {
      console.error('Error fetching region data:', error);
      throw error;
    }
  }

  return regionMapCache.regionMap;
}

/**
 * Fetches regions from Medusa and sets the region cookie.
 * @param request
 * @param response
 */
async function getCountryCode(
  request: NextRequest,
  regionMap: Map<string, Region | number>
) {
  try {
    let countryCode;

    const vercelCountryCode = request.headers
      .get("x-vercel-ip-country")
      ?.toLowerCase();

    const urlCountryCode = request.nextUrl.pathname.split("/")[1]?.toLowerCase();

    if (urlCountryCode && regionMap.has(urlCountryCode)) {
      countryCode = urlCountryCode;
    } else if (vercelCountryCode && regionMap.has(vercelCountryCode)) {
      countryCode = vercelCountryCode;
    } else if (regionMap.has(DEFAULT_REGION)) {
      countryCode = DEFAULT_REGION;
    } else if (regionMap.keys().next().value) {
      countryCode = regionMap.keys().next().value;
    }

    return countryCode;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "Middleware.ts: Error getting the country code. Did you set up regions in your Medusa Admin and define a NEXT_PUBLIC_MEDUSA_BACKEND_URL environment variable?"
      );
    }
  }
}

/**
 * Middleware to handle region selection and onboarding status.
 */
export async function middleware(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const isOnboarding = searchParams.get("onboarding") === "true";
  const cartId = searchParams.get("cart_id");
  const checkoutStep = searchParams.get("step");
  const onboardingCookie = request.cookies.get("_medusa_onboarding");
  const cartIdCookie = request.cookies.get("_medusa_cart_id");

  const regionMap = await getRegionMap();
  const countryCode = regionMap && (await getCountryCode(request, regionMap));

  const urlHasCountryCode =
    countryCode && request.nextUrl.pathname.split("/")[1].includes(countryCode);

  if (
    urlHasCountryCode &&
    (!isOnboarding || onboardingCookie) &&
    (!cartId || cartIdCookie)
  ) {
    return NextResponse.next();
  }

  const redirectPath =
    request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname;

  const queryString = request.nextUrl.search ? request.nextUrl.search : "";

  let redirectUrl = request.nextUrl.href;

  let response = NextResponse.redirect(redirectUrl, 307);

  // If no country code is set, we redirect to the relevant region.
  if (!urlHasCountryCode && countryCode) {
    redirectUrl = `${request.nextUrl.origin}/${countryCode}${redirectPath}${queryString}`;
    response = NextResponse.redirect(`${redirectUrl}`, 307);
  }

  // If a cart_id is in the params, we set it as a cookie and redirect to the address step.
  if (cartId && !checkoutStep) {
    redirectUrl = `${redirectUrl}&step=address`;
    response = NextResponse.redirect(`${redirectUrl}`, 307);
    response.cookies.set("_medusa_cart_id", cartId, { maxAge: 60 * 60 * 24 });
  }

  // Set a cookie to indicate that we're onboarding. This is used to show the onboarding flow.
  if (isOnboarding) {
    response.cookies.set("_medusa_onboarding", "true", { maxAge: 60 * 60 * 24 });
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|favicon.ico).*)"],
};
