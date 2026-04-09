import { NextResponse } from "next/server";

const DEFAULT_TOKA_BASE_URL = "http://talentland-toka.eastus2.cloudapp.azure.com";

export async function POST(request: Request) {
  const appId = process.env.TOKA_APP_ID || "3500020265479238";
  const baseUrl = (process.env.TOKA_API_BASE_URL ?? DEFAULT_TOKA_BASE_URL).replace(/\/$/, "");

  // Extraer el Toka Access Token del header Authorization
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { success: false, message: "Token de Toka no proporcionado." },
      { status: 401 }
    );
  }
  const tokaAccessToken = authHeader.replace("Bearer ", "");

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  try {
    // Crear la orden de pago en Toka
    const tokaResponse = await fetch(`${baseUrl}/v1/payment/pay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": appId,
        "Authorization": `Bearer ${tokaAccessToken}`,
      },
      body: JSON.stringify({
        amount: body.amount || 100,
        subject: body.description || "Suscripción Toka Tribe",
        outTradeNo: `TOKA_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        subscriptionTier: body.subscriptionTier,
      }),
    });

    const contentType = tokaResponse.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await tokaResponse.json()
      : await tokaResponse.text();

    if (typeof payload === "string") {
      return NextResponse.json(
        { success: tokaResponse.ok, statusCode: tokaResponse.status, message: payload, data: null },
        { status: tokaResponse.status }
      );
    }

    return NextResponse.json(payload, { status: tokaResponse.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error contactando Toka para pagos.";
    return NextResponse.json(
      { success: false, statusCode: 502, message, data: null },
      { status: 502 }
    );
  }
}
