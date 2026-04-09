import { NextResponse } from "next/server";

const DEFAULT_TOKA_BASE_URL = "http://talentland-toka.eastus2.cloudapp.azure.com";
const TOKA_APP_ID = "3500020265479238";

export async function POST(request: Request) {
  const baseUrl = (process.env.TOKA_API_BASE_URL ?? DEFAULT_TOKA_BASE_URL).replace(/\/$/, "");

  // Extraer el Toka Access Token del header Authorization
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { success: false, message: "Token de Toka no proporcionado.", debug: { authHeader } },
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

  // El value debe ser string con formato decimal "1.00"
  const amountValue = body.amount
    ? (Number(body.amount) / 100).toFixed(2)
    : "1.00";

  const tokaPayload = {
    userId: body.userId || "000000000000000",
    orderTitle: body.orderTitle || "Suscripción Toka Tribe",
    orderAmount: {
      value: amountValue,
      currency: "MXN",
    },
  };

  const tokaHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-App-Id": TOKA_APP_ID,
    "Authorization": `Bearer ${tokaAccessToken}`,
    "Alipay-MerchantCode": process.env.TOKA_MERCHANT_CODE || "Bltrn",
  };

  try {
    const tokaResponse = await fetch(`${baseUrl}/v1/payment/create`, {
      method: "POST",
      headers: tokaHeaders,
      body: JSON.stringify(tokaPayload),
    });

    const contentType = tokaResponse.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await tokaResponse.json()
      : await tokaResponse.text();

    // Devolver siempre info de debug para rastrear el 401
    const debugInfo = {
      sentTo: `${baseUrl}/v1/payment/create`,
      sentHeaders: {
        "X-App-Id": TOKA_APP_ID,
        "Authorization": `Bearer ${tokaAccessToken.slice(0, 20)}...`,
        "Alipay-MerchantCode": tokaHeaders["Alipay-MerchantCode"],
      },
      sentBody: tokaPayload,
      tokaStatus: tokaResponse.status,
    };

    if (typeof payload === "string") {
      return NextResponse.json(
        { success: false, statusCode: tokaResponse.status, message: payload, data: null, debug: debugInfo },
        { status: tokaResponse.status }
      );
    }

    // Inyectar debug en la respuesta para ver exactamente qué pasó
    return NextResponse.json(
      { ...payload, debug: debugInfo },
      { status: tokaResponse.status }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error contactando Toka para pagos.";
    return NextResponse.json(
      { success: false, statusCode: 502, message, data: null },
      { status: 502 }
    );
  }
}
