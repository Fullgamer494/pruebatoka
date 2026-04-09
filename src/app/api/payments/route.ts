import { NextResponse } from "next/server";

const DEFAULT_TOKA_BASE_URL = "http://talentland-toka.eastus2.cloudapp.azure.com";

export async function POST(request: Request) {
  const appId = process.env.TOKA_APP_ID || "3500020265479238";
  const merchantCode = process.env.TOKA_MERCHANT_CODE || "";
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
    // POST /v1/payment/create — Documentación oficial de Toka
    const tokaResponse = await fetch(`${baseUrl}/v1/payment/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": appId,
        "Authorization": `Bearer ${tokaAccessToken}`,
        "Alipay-MerchantCode": merchantCode,
      },
      body: JSON.stringify({
        userId: body.userId || "000000000000000",
        orderTitle: body.orderTitle || body.description || "Suscripción Toka Tribe",
        orderAmount: {
          value: String(body.amount || "100"),
          currency: "MXN",
        },
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

    // Respuesta exitosa de Toka:
    // { success: true, statusCode: 200, message: "Payment created successfully.",
    //   data: { paymentId: "2026...", paymentUrl: "https://app.sit.nonprod.paypay.mx/..." } }
    return NextResponse.json(payload, { status: tokaResponse.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error contactando Toka para pagos.";
    return NextResponse.json(
      { success: false, statusCode: 502, message, data: null },
      { status: 502 }
    );
  }
}
